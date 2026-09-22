/** Evidence scope for demo-artwork-v1. This is not a production acceptance record. */
export const catalogStatus = {
  "catalog_version": "demo-artwork-v1",
  "production_ready": false,
  "artwork": {
    "required": 48,
    "available": 12,
    "missing": 36,
    "available_steps": [
      1,
      2,
      3,
      4
    ],
    "missing_steps": [
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
      16
    ]
  },
  "source_images": {
    "inspected": [
      "B01",
      "B02",
      "B03",
      "02A",
      "02B",
      "02C",
      "03A",
      "03B",
      "03C",
      "04A",
      "04B",
      "04C"
    ],
    "dimensions": "1254 × 1254 RGBA for all 12 assets",
    "content_bounds_definition": "Minimal rectangle containing all pixels with alpha > 0. Right/bottom edges are exclusive.",
    "byte_identical_copies": true,
    "sha256": {
      "B01": "e9183d75407c8dca9332e296394038ae030fb9481a2e0b28cdb688f75a2a2843",
      "B02": "8d8d275a1fc3eb341175ebec2f73377bea97f45be7060766fbd0da958347e245",
      "B03": "23464a11f6be90ce9cab724ef51298ae62481e25aeb1d4543b6f9526588096e2",
      "02A": "30efd8f7843efbdf9041978c2b3ddb2f6348389dd1afe608825efc15b293ee71",
      "02B": "985f2f945a206680b12a1942c344d442c9afafaa0af167c9b28fefd736ef9c37",
      "02C": "0b566e58f010a1421e63bf3c7b50cc3f4e99291c0bd8842f93f45bfc6b2c9394",
      "03A": "40a635f479c0719912dd243f0aae67b375d3fdaa7c1a41eb45d4a2884f523ec3",
      "03B": "47572413459ba6f57bbbf74ef0fdfe18b91a76b7bb1ac5a07d38fcc08d9d25e0",
      "03C": "4c180ee5c2c110107e372b9fc537bda524671485172970ad5bc52083ce2431fb",
      "04A": "a45fde75387295bf2c2f83f0ae232278ad7379d6e130559d736b2699da03ce00",
      "04B": "10f4d8f9f6a6075779abb2e29e41196a47ccda8c4928b930c62d1673305c26fd",
      "04C": "9132ca806fbbe5cd480fb071533c59ab3a10956e7c0f08ccd1c9f7112e84e693"
    }
  },
  "numeric_validation": {
    "status": "passed-for-available-prefix",
    "compositions_checked": 81,
    "layer_bounds_checked": 324,
    "failed_canvas_bounds": 0,
    "union_bounds": [
      154.875,
      166.64,
      813.7750000000001,
      936.87
    ],
    "minimum_visible_eye_mouth_gap": 6.83,
    "method": "Apply the manifest transform to the four corners of each measured content_bounds and test the transformed AABB against 1000 × 1000. Enumerate all 3 × 3 × 3 × 3 early compositions; require unique z. Visible alpha > 32 rectangles are only a secondary eye/mouth gap diagnostic."
  },
  "visual_validation": {
    "source_pngs": "inspected-all-12",
    "assembled_compositions": "inspected-contact-sheet-2026-09-22",
    "all_81_compositions": "visually-inspected",
    "steps_5_to_16": "blocked-missing-artwork",
    "notes": "81 step-4 combinations inspected in docs/asset-compositions-81.png. No missing layers, scene overflow or eye-mouth intersection observed. Future 16-step readability remains unverified."
  },
  "reserved_zones_status": "planning-only-not-tested-with-future-artwork"
} as const;
