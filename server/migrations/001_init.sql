-- Peredai v1. Apply with the migration role, never from an HTTP request.
CREATE TABLE catalog_version (
  version text PRIMARY KEY,
  manifest jsonb NOT NULL,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  brand text NOT NULL,
  offer text NOT NULL,
  cta_target text,
  active_catalog_version text NOT NULL REFERENCES catalog_version(version),
  accepts_contributions boolean NOT NULL DEFAULT false,
  max_creatures bigint NOT NULL CHECK (max_creatures > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE anonymous_profile (
  id uuid PRIMARY KEY,
  session_secret_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);

CREATE TABLE creature (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaign(id),
  owner_profile_id uuid NOT NULL REFERENCES anonymous_profile(id),
  origin_share_id uuid,
  revision_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE creature_revision (
  id uuid PRIMARY KEY,
  creature_id uuid NOT NULL UNIQUE REFERENCES creature(id) DEFERRABLE INITIALLY DEFERRED,
  catalog_version text NOT NULL REFERENCES catalog_version(version),
  appearance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creature_id, id)
);

ALTER TABLE creature ADD CONSTRAINT creature_revision_pair_fk
  FOREIGN KEY (id, revision_id) REFERENCES creature_revision(creature_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE share_link (
  id uuid PRIMARY KEY,
  public_token text NOT NULL UNIQUE,
  source_revision_id uuid NOT NULL UNIQUE REFERENCES creature_revision(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE creature ADD CONSTRAINT creature_origin_share_fk
  FOREIGN KEY (origin_share_id) REFERENCES share_link(id);
CREATE UNIQUE INDEX one_child_per_profile_and_share ON creature(origin_share_id, owner_profile_id)
  WHERE origin_share_id IS NOT NULL;

CREATE TABLE operation_receipt (
  profile_id uuid NOT NULL REFERENCES anonymous_profile(id),
  operation_type text NOT NULL CHECK (operation_type IN ('create_root','create_offspring','create_share')),
  idempotency_key text NOT NULL,
  normalized_target jsonb NOT NULL,
  normalized_body jsonb NOT NULL,
  http_status smallint NOT NULL CHECK (http_status IN (200,201)),
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, operation_type, idempotency_key)
);

CREATE TABLE client_event (
  profile_id uuid NOT NULL REFERENCES anonymous_profile(id),
  event_id uuid NOT NULL,
  creature_id uuid NOT NULL REFERENCES creature(id),
  kind text NOT NULL CHECK (kind = 'cta_click_reported'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, event_id)
);

-- Also protect quota from a second writer using the runtime role directly.
-- All inserts in a campaign acquire the same lock and read a fresh count.
CREATE FUNCTION protect_creature_quota() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cap bigint;
  enabled boolean;
  used bigint;
BEGIN
  SELECT max_creatures,accepts_contributions INTO STRICT cap,enabled
    FROM campaign WHERE id=NEW.campaign_id FOR UPDATE;
  IF NOT enabled THEN RAISE EXCEPTION 'campaign closed'; END IF;
  SELECT count(*) INTO used FROM creature WHERE campaign_id=NEW.campaign_id;
  IF used >= cap THEN RAISE EXCEPTION 'campaign quota exceeded'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER creature_quota BEFORE INSERT ON creature
FOR EACH ROW EXECUTE FUNCTION protect_creature_quota();

CREATE INDEX creature_owner_page ON creature(owner_profile_id, created_at, id);
CREATE INDEX creature_campaign_quota ON creature(campaign_id);
CREATE INDEX creature_children_page ON creature(origin_share_id, created_at, id);
CREATE INDEX client_event_creature ON client_event(creature_id, received_at);

CREATE FUNCTION valid_appearance(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  item jsonb;
  expected_step integer := 2;
BEGIN
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(value)) <> 2
    OR NOT (value ? 'base_id') OR NOT (value ? 'choices')
    OR jsonb_typeof(value->'base_id') <> 'string'
    OR value->>'base_id' NOT IN ('B01','B02','B03')
    OR jsonb_typeof(value->'choices') <> 'array'
  THEN RETURN false; END IF;
  IF jsonb_array_length(value->'choices') > 15 THEN RETURN false; END IF;
  FOR item IN SELECT elem FROM jsonb_array_elements(value->'choices') AS elem LOOP
    IF jsonb_typeof(item) <> 'object' THEN RETURN false; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
      OR NOT (item ? 'step') OR NOT (item ? 'choice_id')
      OR jsonb_typeof(item->'step') <> 'number'
      OR item->>'step' <> expected_step::text
      OR jsonb_typeof(item->'choice_id') <> 'string'
      OR item->>'choice_id' !~ ('^' || lpad(expected_step::text, 2, '0') || '[ABC]$')
    THEN RETURN false; END IF;
    expected_step := expected_step + 1;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE creature_revision ADD CONSTRAINT appearance_shape
  CHECK (valid_appearance(appearance) IS TRUE);

CREATE FUNCTION check_creature_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  node creature%ROWTYPE;
  parent_node creature%ROWTYPE;
  parent_revision creature_revision%ROWTYPE;
  manifest jsonb;
  choice text;
  next_step integer;
BEGIN
  SELECT * INTO STRICT node FROM creature WHERE id = NEW.creature_id;
  SELECT c.manifest INTO STRICT manifest FROM catalog_version c WHERE c.version = NEW.catalog_version AND c.published;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(manifest->'bases') AS b
    WHERE b->>'base_id' = NEW.appearance->>'base_id'
  ) THEN RAISE EXCEPTION 'base absent from catalog'; END IF;
  IF node.origin_share_id IS NULL THEN
    IF jsonb_array_length(NEW.appearance->'choices') <> 0
      OR NEW.catalog_version <> (SELECT active_catalog_version FROM campaign WHERE id = node.campaign_id)
    THEN RAISE EXCEPTION 'invalid root revision'; END IF;
  ELSE
    SELECT c.* INTO STRICT parent_node FROM share_link s
      JOIN creature_revision r ON r.id = s.source_revision_id
      JOIN creature c ON c.id = r.creature_id WHERE s.id = node.origin_share_id;
    SELECT * INTO STRICT parent_revision FROM creature_revision WHERE id = parent_node.revision_id;
    next_step := jsonb_array_length(parent_revision.appearance->'choices') + 2;
    IF next_step > 16 OR parent_node.campaign_id <> node.campaign_id
      OR parent_node.owner_profile_id = node.owner_profile_id
      OR NEW.catalog_version <> parent_revision.catalog_version
      OR NEW.appearance->>'base_id' <> parent_revision.appearance->>'base_id'
      OR jsonb_array_length(NEW.appearance->'choices') <> next_step - 1
      OR (NEW.appearance->'choices') - (next_step - 2) <> parent_revision.appearance->'choices'
    THEN RAISE EXCEPTION 'invalid inheritance'; END IF;
    choice := (NEW.appearance->'choices'->(next_step - 2))->>'choice_id';
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(manifest->'steps') st,
        jsonb_array_elements(st->'options') opt
      WHERE (st->>'step')::integer = next_step AND opt->>'choice_id' = choice
    ) THEN RAISE EXCEPTION 'choice absent from catalog'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER check_revision BEFORE INSERT ON creature_revision
FOR EACH ROW EXECUTE FUNCTION check_creature_revision();

CREATE FUNCTION immutable_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable business record'; END $$;
CREATE TRIGGER creature_immutable BEFORE UPDATE OR DELETE ON creature
FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER revision_immutable BEFORE UPDATE OR DELETE ON creature_revision
FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER share_immutable BEFORE UPDATE OR DELETE ON share_link
FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER receipt_immutable BEFORE UPDATE OR DELETE ON operation_receipt
FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER catalog_immutable BEFORE UPDATE OR DELETE ON catalog_version
FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- The runtime role may lock Campaign rows, but may not alter configuration.
-- The migration/operations owner stays separate from peredai_runtime.
CREATE ROLE peredai_runtime NOLOGIN;
CREATE FUNCTION guard_campaign_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    AND pg_has_role(current_user, 'peredai_runtime', 'member') THEN
    RAISE EXCEPTION 'runtime cannot change campaign configuration';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_config_guard BEFORE UPDATE OR DELETE ON campaign
FOR EACH ROW EXECUTE FUNCTION guard_campaign_update();
GRANT USAGE ON SCHEMA public TO peredai_runtime;
GRANT SELECT ON catalog_version,campaign,anonymous_profile,creature,creature_revision,
  share_link,operation_receipt,client_event TO peredai_runtime;
GRANT INSERT ON anonymous_profile,creature,creature_revision,share_link,
  operation_receipt,client_event TO peredai_runtime;
GRANT UPDATE ON campaign TO peredai_runtime;
