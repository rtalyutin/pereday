/**
 * Partial demonstration catalog, not a production CatalogVersion.
 * Original PNG bytes are copied without crop, resize, cleanup, or re-encoding.
 * Coordinates follow Frontend-TZ §8.1: T(x,y) R(clockwise) S(scale) T(-anchor).
 * Render every PNG at its declared source size, then scale the whole 1000² scene.
 * Exact content_bounds include all non-zero alpha, including faint source artifacts.
 * Available artwork ends at step 4; steps 5–16 are intentionally absent here.
 */
import type { DemoCatalog } from './core/types';

export const assetSourceFiles = {
  "B01": "Пельмень Бездны — базовое тело.png",
  "B02": "Кирпич-пророк: округлый терракотовый блок.png",
  "B03": "Базовое тело кабачка-пришельца.png",
  "02A": "Один глаз в виде яичницы.png",
  "02B": "Пара винтажных глаз-фар.png",
  "02C": "Три зелёных глаза-горошины.png",
  "03A": "Серебряная молния-улыбка.png",
  "03B": "Улыбка из фортепианных клавиш.png",
  "03C": "Игрушечный слот банкомата.png",
  "04A": "Парные куриные ножки в уютных носочках.png",
  "04B": "Парные миниатюрные гусеничные лапки.png",
  "04C": "Серебряные пружинные ножки в тапочках.png"
} as const;

export const demoCatalog: DemoCatalog = {
  "version": "demo-artwork-v1",
  "total_steps": 16,
  "canvas": {
    "width": 1000,
    "height": 1000
  },
  "assets": {
    "B01": {
      "src": "/assets/demo-artwork-v1/B01.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 73,
        "y": 8,
        "width": 1157,
        "height": 1246
      }
    },
    "B02": {
      "src": "/assets/demo-artwork-v1/B02.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 0,
        "y": 21,
        "width": 1198,
        "height": 1193
      }
    },
    "B03": {
      "src": "/assets/demo-artwork-v1/B03.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 93,
        "y": 21,
        "width": 1117,
        "height": 1163
      }
    },
    "02A": {
      "src": "/assets/demo-artwork-v1/02A.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 91,
        "y": 52,
        "width": 1047,
        "height": 1160
      }
    },
    "02B": {
      "src": "/assets/demo-artwork-v1/02B.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 41,
        "y": 53,
        "width": 1169,
        "height": 1159
      }
    },
    "02C": {
      "src": "/assets/demo-artwork-v1/02C.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 89,
        "y": 21,
        "width": 1121,
        "height": 1191
      }
    },
    "03A": {
      "src": "/assets/demo-artwork-v1/03A.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 41,
        "y": 21,
        "width": 1169,
        "height": 1191
      }
    },
    "03B": {
      "src": "/assets/demo-artwork-v1/03B.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 91,
        "y": 53,
        "width": 1127,
        "height": 1129
      }
    },
    "03C": {
      "src": "/assets/demo-artwork-v1/03C.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 129,
        "y": 52,
        "width": 998,
        "height": 1098
      }
    },
    "04A": {
      "src": "/assets/demo-artwork-v1/04A.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 69,
        "y": 21,
        "width": 1145,
        "height": 1233
      }
    },
    "04B": {
      "src": "/assets/demo-artwork-v1/04B.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 89,
        "y": 21,
        "width": 1143,
        "height": 1193
      }
    },
    "04C": {
      "src": "/assets/demo-artwork-v1/04C.png",
      "width": 1254,
      "height": 1254,
      "content_bounds": {
        "x": 0,
        "y": 21,
        "width": 1230,
        "height": 1233
      }
    }
  },
  "bases": [
    {
      "base_id": "B01",
      "label": "Пельмень Бездны",
      "asset_id": "B01",
      "placement": {
        "anchor": {
          "x": 626.5,
          "y": 1044
        },
        "x": 500,
        "y": 695,
        "scale": 0.51,
        "rotation_deg": 0,
        "z": 20
      }
    },
    {
      "base_id": "B02",
      "label": "Кирпич-пророк",
      "asset_id": "B02",
      "placement": {
        "anchor": {
          "x": 627.5,
          "y": 965
        },
        "x": 500,
        "y": 695,
        "scale": 0.55,
        "rotation_deg": 0,
        "z": 20
      }
    },
    {
      "base_id": "B03",
      "label": "Кабачок-пришелец",
      "asset_id": "B03",
      "placement": {
        "anchor": {
          "x": 627.5,
          "y": 1156
        },
        "x": 500,
        "y": 695,
        "scale": 0.44,
        "rotation_deg": 0,
        "z": 20
      }
    }
  ],
  "steps": [
    {
      "step": 2,
      "options": [
        {
          "choice_id": "02A",
          "label": "Один глаз-яичница",
          "asset_id": "02A",
          "placements": {
            "B01": {
              "anchor": {
                "x": 627,
                "y": 623.5
              },
              "x": 500,
              "y": 412,
              "scale": 0.315,
              "rotation_deg": 0,
              "z": 40
            },
            "B02": {
              "anchor": {
                "x": 627,
                "y": 623.5
              },
              "x": 500,
              "y": 415,
              "scale": 0.34,
              "rotation_deg": 0,
              "z": 40
            },
            "B03": {
              "anchor": {
                "x": 627,
                "y": 623.5
              },
              "x": 500,
              "y": 410,
              "scale": 0.29,
              "rotation_deg": 0,
              "z": 40
            }
          },
          "clip_to_base": false
        },
        {
          "choice_id": "02B",
          "label": "Два глаза-фары",
          "asset_id": "02B",
          "placements": {
            "B01": {
              "anchor": {
                "x": 627,
                "y": 626.5
              },
              "x": 500,
              "y": 412,
              "scale": 0.285,
              "rotation_deg": 0,
              "z": 40
            },
            "B02": {
              "anchor": {
                "x": 627,
                "y": 626.5
              },
              "x": 500,
              "y": 415,
              "scale": 0.31,
              "rotation_deg": 0,
              "z": 40
            },
            "B03": {
              "anchor": {
                "x": 627,
                "y": 626.5
              },
              "x": 500,
              "y": 410,
              "scale": 0.24,
              "rotation_deg": 0,
              "z": 40
            }
          },
          "clip_to_base": false
        },
        {
          "choice_id": "02C",
          "label": "Три глаза-горошины",
          "asset_id": "02C",
          "placements": {
            "B01": {
              "anchor": {
                "x": 625,
                "y": 644.5
              },
              "x": 500,
              "y": 412,
              "scale": 0.31,
              "rotation_deg": 0,
              "z": 40
            },
            "B02": {
              "anchor": {
                "x": 625,
                "y": 644.5
              },
              "x": 500,
              "y": 415,
              "scale": 0.34,
              "rotation_deg": 0,
              "z": 40
            },
            "B03": {
              "anchor": {
                "x": 625,
                "y": 644.5
              },
              "x": 500,
              "y": 410,
              "scale": 0.25,
              "rotation_deg": 0,
              "z": 40
            }
          },
          "clip_to_base": false
        }
      ]
    },
    {
      "step": 3,
      "options": [
        {
          "choice_id": "03A",
          "label": "Застёжка-молния",
          "asset_id": "03A",
          "placements": {
            "B01": {
              "anchor": {
                "x": 627,
                "y": 670
              },
              "x": 500,
              "y": 550,
              "scale": 0.27,
              "rotation_deg": 0,
              "z": 50
            },
            "B02": {
              "anchor": {
                "x": 627,
                "y": 670
              },
              "x": 500,
              "y": 560,
              "scale": 0.285,
              "rotation_deg": 0,
              "z": 50
            },
            "B03": {
              "anchor": {
                "x": 627,
                "y": 670
              },
              "x": 500,
              "y": 535,
              "scale": 0.205,
              "rotation_deg": 0,
              "z": 50
            }
          },
          "clip_to_base": false
        },
        {
          "choice_id": "03B",
          "label": "Улыбка из клавиш пианино",
          "asset_id": "03B",
          "placements": {
            "B01": {
              "anchor": {
                "x": 627.5,
                "y": 666
              },
              "x": 500,
              "y": 550,
              "scale": 0.27,
              "rotation_deg": 0,
              "z": 50
            },
            "B02": {
              "anchor": {
                "x": 627.5,
                "y": 666
              },
              "x": 500,
              "y": 560,
              "scale": 0.28,
              "rotation_deg": 0,
              "z": 50
            },
            "B03": {
              "anchor": {
                "x": 627.5,
                "y": 666
              },
              "x": 500,
              "y": 535,
              "scale": 0.21,
              "rotation_deg": 0,
              "z": 50
            }
          },
          "clip_to_base": false
        },
        {
          "choice_id": "03C",
          "label": "Щель банкомата",
          "asset_id": "03C",
          "placements": {
            "B01": {
              "anchor": {
                "x": 627,
                "y": 643.5
              },
              "x": 500,
              "y": 550,
              "scale": 0.26,
              "rotation_deg": 0,
              "z": 50
            },
            "B02": {
              "anchor": {
                "x": 627,
                "y": 643.5
              },
              "x": 500,
              "y": 560,
              "scale": 0.28,
              "rotation_deg": 0,
              "z": 50
            },
            "B03": {
              "anchor": {
                "x": 627,
                "y": 643.5
              },
              "x": 500,
              "y": 535,
              "scale": 0.2,
              "rotation_deg": 0,
              "z": 50
            }
          },
          "clip_to_base": false
        }
      ]
    },
    {
      "step": 4,
      "options": [
        {
          "choice_id": "04A",
          "label": "Куриные лапы в носках",
          "asset_id": "04A",
          "placements": {
            "B01": {
              "anchor": {
                "x": 627,
                "y": 377
              },
              "x": 500,
              "y": 665,
              "scale": 0.3,
              "rotation_deg": 0,
              "z": 10
            },
            "B02": {
              "anchor": {
                "x": 627,
                "y": 377
              },
              "x": 500,
              "y": 665,
              "scale": 0.31,
              "rotation_deg": 0,
              "z": 10
            },
            "B03": {
              "anchor": {
                "x": 627,
                "y": 377
              },
              "x": 500,
              "y": 665,
              "scale": 0.27,
              "rotation_deg": 0,
              "z": 10
            }
          },
          "clip_to_base": false
        },
        {
          "choice_id": "04B",
          "label": "Миниатюрные гусеницы",
          "asset_id": "04B",
          "placements": {
            "B01": {
              "anchor": {
                "x": 627,
                "y": 413
              },
              "x": 500,
              "y": 665,
              "scale": 0.31,
              "rotation_deg": 0,
              "z": 10
            },
            "B02": {
              "anchor": {
                "x": 627,
                "y": 413
              },
              "x": 500,
              "y": 665,
              "scale": 0.33,
              "rotation_deg": 0,
              "z": 10
            },
            "B03": {
              "anchor": {
                "x": 627,
                "y": 413
              },
              "x": 500,
              "y": 665,
              "scale": 0.26,
              "rotation_deg": 0,
              "z": 10
            }
          },
          "clip_to_base": false
        },
        {
          "choice_id": "04C",
          "label": "Пружины в тапочках",
          "asset_id": "04C",
          "placements": {
            "B01": {
              "anchor": {
                "x": 627,
                "y": 353
              },
              "x": 500,
              "y": 665,
              "scale": 0.285,
              "rotation_deg": 0,
              "z": 10
            },
            "B02": {
              "anchor": {
                "x": 627,
                "y": 353
              },
              "x": 500,
              "y": 665,
              "scale": 0.3,
              "rotation_deg": 0,
              "z": 10
            },
            "B03": {
              "anchor": {
                "x": 627,
                "y": 353
              },
              "x": 500,
              "y": 665,
              "scale": 0.25,
              "rotation_deg": 0,
              "z": 10
            }
          },
          "clip_to_base": false
        }
      ]
    }
  ],
  "status": "partial-demo",
  "available_steps": [
    1,
    2,
    3,
    4
  ],
  "missing_asset_count": 36,
  "production_ready": false
};
