import type { MainWebsiteProduct } from "./catalog-types";

export const FALLBACK_CLASSIC_CATALOG: MainWebsiteProduct[] = [
  {
    id: "cat_podium_053",
    brand: "CLASSIC_CONCEPTS",
    brandLabel: "Classic Concepts",
    itemType: "PRODUCT",
    name: "Full Clear Auditorium Acrylic Podium CCP-053",
    slug: "acrylic-podium-ccp053",
    sku: "CCP-053",
    categoryName: "Acrylic Podiums",
    basePrice: 24500,
    mainImage: null,
    url: "https://classicconcepts.in/shop/p/acrylic-podium-ccp053",
  },
  {
    id: "cat_tstand_a4",
    brand: "CLASSIC_CONCEPTS",
    brandLabel: "Classic Concepts",
    itemType: "PRODUCT",
    name: "Crystal Clear A4 Table Menu & Sign Stand",
    slug: "a4-t-stand-1",
    sku: "CC-TS-A4",
    categoryName: "Signage & Holders",
    basePrice: 450,
    mainImage: null,
    url: "https://classicconcepts.in/shop/p/a4-t-stand-1",
  },
  {
    id: "cat_memento_01",
    brand: "CLASSIC_CONCEPTS",
    brandLabel: "Classic Concepts",
    itemType: "PRODUCT",
    name: "Acrylic Flame Excellence Memento & Trophy",
    slug: "acrylic-ganesha-flame-memento",
    sku: "CC-AWD-01",
    categoryName: "Awards & Mementos",
    basePrice: 1250,
    mainImage: null,
    url: "https://classicconcepts.in/shop/p/acrylic-ganesha-flame-memento",
  },
];

export const FALLBACK_CLASSIC_EDGE_MACHINES: MainWebsiteProduct[] = [
  {
    id: "ce53-diamond-edge-polisher",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "Acrylic Diamond Edge Polishing Machine",
    slug: "diamond-edge-polisher",
    sku: "YN-JW1200 / YN-JW1600",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "Industrial high-speed diamond cutter edge polishing machine for thick cast acrylic sheets up to 100mm, delivering crystal-clear mirror edges in a single pass.",
    features: [
      "Single-pass optical mirror edge finish on cast and extruded acrylic",
      "Precision PCD and natural diamond cutter spindle with low vibration",
      "Adjustable feed speed and cutter depth for thin to extra-thick blocks",
      "Pneumatic clamping beam for distortion-free workpiece holding",
    ],
    specifications: [
      { label: "Max Sheet Thickness", value: "3mm to 100mm", type: "specification" },
      { label: "Spindle Speed", value: "0 - 9000 RPM Variable", type: "specification" },
      { label: "Polishing Angle", value: "0 to 45 Degrees Bevel & Straight", type: "specification" },
      { label: "Power Supply", value: "380V 3-Phase 50Hz", type: "specification" },
    ],
    models: [
      {
        id: "model-yn-jw1200",
        modelName: "YN-JW1200",
        specifications: [
          { label: "Working Length", value: "1200 mm" },
          { label: "Max Sheet Thickness", value: "3mm to 80mm" },
          { label: "Main Spindle Power", value: "1.8 kW" },
          { label: "Polishing Angle", value: "0 degrees straight edge" },
        ],
        resources: [
          {
            title: "YN-JW1200 Technical Datasheet",
            type: "Specification Sheet",
            url: "https://classicedge53.com/products",
          },
        ],
        consumables: ["PCD & Natural Single-Crystal Diamond Polishing Cutters"],
      },
      {
        id: "model-yn-jw1600",
        modelName: "YN-JW1600",
        specifications: [
          { label: "Working Length", value: "1600 mm" },
          { label: "Max Sheet Thickness", value: "3mm to 100mm" },
          { label: "Main Spindle Power", value: "2.2 kW" },
          { label: "Polishing Angle", value: "0 to 45 degrees bevel and straight" },
        ],
        resources: [
          {
            title: "YN-JW1600 Technical Datasheet",
            type: "Specification Sheet",
            url: "https://classicedge53.com/products",
          },
        ],
        consumables: ["PCD & Natural Single-Crystal Diamond Polishing Cutters"],
      },
    ],
    resources: [
      {
        title: "Diamond Edge Polisher Operation & Maintenance Guide",
        type: "User Manual",
        url: "https://classicedge53.com/products",
      },
    ],
    relatedConsumables: ["PCD & Natural Single-Crystal Diamond Polishing Cutters"],
    modelsSummary: "YN-JW1200, YN-JW1600",
    specsSummary:
      "Max Sheet Thickness: 3mm to 100mm, Spindle Speed: 0 - 9000 RPM Variable, Polishing Angle: 0 to 45 Degrees Bevel & Straight, Power Supply: 380V 3-Phase 50Hz | YN-JW1200: Working Length: 1200 mm, Max Sheet Thickness: 3mm to 80mm, Main Spindle Power: 1.8 kW | YN-JW1600: Working Length: 1600 mm, Max Sheet Thickness: 3mm to 100mm, Main Spindle Power: 2.2 kW",
    searchBlob:
      "acrylic diamond edge polishing machine yn-jw1200 yn-jw1600 1200mm 1600mm 3mm to 100mm 80mm 1.8 kw 2.2 kw 0 to 45 degrees bevel mirror finish pcd diamond cutters",
  },
  {
    id: "ce53-acrylic-line-bender",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "Acrylic Sheet Line Bending & Heating Machine",
    slug: "acrylic-heat-bender",
    sku: "ABM-1250 / ABM-2400",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "Precision water-circulated infrared heating and line bending machine for folding acrylic, polycarbonate, PVC, and PETG sheets without surface bubbling or warping.",
    features: [
      "Water-cooled aluminium heating table prevents surrounding sheet warping",
      "Digital PID temperature control for uniform heat distribution",
      "Angle-locking folding jig for repeatable podium, stand, and display bends",
      "Supports single-line and multi-line simultaneous heating",
    ],
    specifications: [
      { label: "Bending Width", value: "1250mm / 2400mm", type: "specification" },
      { label: "Sheet Thickness", value: "1mm to 15mm", type: "specification" },
      { label: "Cooling System", value: "Closed-Loop Water Circulation", type: "specification" },
      { label: "Applicable Materials", value: "Acrylic, PC, PVC, PETG, ABS", type: "specification" },
    ],
    models: [
      {
        id: "model-abm-1250",
        modelName: "ABM-1250",
        specifications: [
          { label: "Effective Bending Width", value: "1250 mm (4 Feet)" },
          { label: "Sheet Thickness Range", value: "1mm to 10mm" },
          { label: "Heating Zones", value: "Single Upper Heating Tube" },
          { label: "Power Consumption", value: "1.5 kW (220V Single Phase)" },
        ],
        resources: [],
        consumables: ["Nichrome & Quartz Heating Tubes for Line Benders"],
      },
      {
        id: "model-abm-2400",
        modelName: "ABM-2400",
        specifications: [
          { label: "Effective Bending Width", value: "2400 mm (8 Feet)" },
          { label: "Sheet Thickness Range", value: "1mm to 15mm" },
          { label: "Heating Zones", value: "Dual Upper & Lower Heating Tubes" },
          { label: "Power Consumption", value: "3.6 kW (220V Single Phase)" },
        ],
        resources: [],
        consumables: ["Nichrome & Quartz Heating Tubes for Line Benders"],
      },
    ],
    resources: [
      {
        title: "ABM Series Acrylic Line Bender Setup Guide",
        type: "Setup Guide",
        url: "https://classicedge53.com/products",
      },
    ],
    relatedConsumables: ["Nichrome & Quartz Heating Tubes for Line Benders"],
    modelsSummary: "ABM-1250, ABM-2400",
    specsSummary:
      "Bending Width: 1250mm / 2400mm, Sheet Thickness: 1mm to 15mm, Cooling System: Closed-Loop Water Circulation | ABM-1250: Effective Bending Width: 1250 mm (4 Feet), Sheet Thickness Range: 1mm to 10mm, Power Consumption: 1.5 kW | ABM-2400: Effective Bending Width: 2400 mm (8 Feet), Sheet Thickness Range: 1mm to 15mm, Dual Upper & Lower Heating Tubes, Power Consumption: 3.6 kW",
    searchBlob:
      "acrylic sheet line bending heating machine abm-1250 abm-2400 1250mm 2400mm 4 feet 8 feet 1mm to 10mm 1mm to 15mm 1.5 kw 3.6 kw water cooled pid temperature",
  },
  {
    id: "ce53-laser-cutting-system",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "CO2 Acrylic Laser Cutting & Engraving Machine",
    slug: "co2-acrylic-laser-cutter",
    sku: "CE-LC1390 / CE-LC1325",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "Heavy-duty CO2 laser cutting and engraving system engineered for cast acrylic fabrication, trophies, podium panels, signage letters, and precision display parts.",
    features: [
      "Flame-polished crystal clear cut edges on cast acrylic up to 25mm",
      "Knife-blade bed designed to minimize back-reflection marks on clear sheets",
      "Ruida digital controller compatible with LightBurn and CorelDraw",
      "Industrial CW-5200 water chiller and exhaust blower included",
    ],
    specifications: [
      { label: "Working Bed Size", value: "1300x900mm / 1300x2500mm", type: "specification" },
      { label: "Laser Power", value: "100W / 130W / 150W RECI CO2", type: "specification" },
      { label: "Max Acrylic Cutting Thickness", value: "Up to 25mm Cast Acrylic", type: "specification" },
      { label: "Table Type", value: "Anodized Knife Blade & Honeycomb", type: "specification" },
    ],
    models: [
      {
        id: "model-ce-lc1390",
        modelName: "CE-LC1390",
        specifications: [
          { label: "Working Area", value: "1300 x 900 mm" },
          { label: "Laser Tube Options", value: "100W / 130W RECI CO2" },
          { label: "Max Acrylic Thickness", value: "20 mm" },
        ],
        resources: [],
        consumables: [],
      },
      {
        id: "model-ce-lc1325",
        modelName: "CE-LC1325",
        specifications: [
          { label: "Working Area", value: "1300 x 2500 mm (Full 8x4 Sheet)" },
          { label: "Laser Tube Options", value: "130W / 150W RECI CO2" },
          { label: "Max Acrylic Thickness", value: "25 mm" },
        ],
        resources: [],
        consumables: [],
      },
    ],
    resources: [],
    relatedConsumables: [],
    modelsSummary: "CE-LC1390, CE-LC1325",
    specsSummary:
      "Working Bed Size: 1300x900mm / 1300x2500mm, Laser Power: 100W / 130W / 150W RECI CO2, Max Acrylic Cutting Thickness: Up to 25mm | CE-LC1390: 1300 x 900 mm, Max 20 mm | CE-LC1325: 1300 x 2500 mm, Max 25 mm",
    searchBlob:
      "co2 acrylic laser cutting engraving machine ce-lc1390 ce-lc1325 1300x900mm 1300x2500mm 100w 130w 150w reci 20mm 25mm",
  },
  {
    id: "ce53-cnc-router-acrylic",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "3-Axis Acrylic & Sign Making CNC Router",
    slug: "acrylic-cnc-router-1325",
    sku: "CE-CNC1325",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "High-rigidity 8x4 ft CNC router with mist cooling for heavy acrylic block routing, chamfering, grooving, LED letter housing, and composite sheet cutting.",
    features: [
      "Heavy welded tubular steel frame for vibration-free thick acrylic routing",
      "Dual-zone vacuum table with T-slot clamps for small and full-sheet parts",
      "Mist coolant sprayer prevents chip re-welding on acrylic edges",
    ],
    specifications: [
      { label: "Working Area", value: "1300mm x 2500mm x 200mm", type: "specification" },
      { label: "Spindle", value: "3.5kW / 4.5kW Water or Air Cooled", type: "specification" },
      { label: "Table Structure", value: "Vacuum Bed + T-Slot Aluminium Table", type: "specification" },
    ],
    models: [
      {
        id: "model-ce-cnc1325",
        modelName: "CE-CNC1325",
        specifications: [
          { label: "Working Area", value: "1300 x 2500 x 200 mm" },
          { label: "Spindle Power", value: "3.5 kW / 4.5 kW" },
          { label: "Drive System", value: "Helical Rack & Pinion + Linear Guides" },
        ],
        resources: [],
        consumables: ["Single-Flute Spiral Carbide CNC Router Bits for Acrylic"],
      },
    ],
    resources: [],
    relatedConsumables: ["Single-Flute Spiral Carbide CNC Router Bits for Acrylic"],
    modelsSummary: "CE-CNC1325",
    specsSummary:
      "Working Area: 1300mm x 2500mm x 200mm, Spindle: 3.5kW / 4.5kW Water or Air Cooled, Table Structure: Vacuum Bed + T-Slot Aluminium Table",
    searchBlob:
      "3-axis acrylic sign making cnc router ce-cnc1325 1300x2500mm 3.5kw 4.5kw vacuum bed",
  },
  {
    id: "ce53-flame-polishing-unit",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "HHO Oxy-Hydrogen Acrylic Flame Polishing Machine",
    slug: "hho-acrylic-flame-polisher",
    sku: "CE-FP160 / CE-FP260",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "Portable oxy-hydrogen water-electrolysis flame polishing generator for rapid crystal-clear polishing of curved, internal, and intricate acrylic edges.",
    features: [
      "Produces clean oxy-hydrogen flame on demand using distilled water",
      "Ideal for curved edges, internal cutouts, and letters where diamond polishers cannot reach",
      "Multi-stage flashback arrestor and over-pressure safety cut-off",
    ],
    specifications: [
      { label: "Gas Output", value: "160 L/H to 260 L/H", type: "specification" },
      { label: "Max Acrylic Thickness", value: "Up to 12mm Curved & Internal Edges", type: "specification" },
      { label: "Consumable Medium", value: "Distilled Water + KOH Electrolyte", type: "specification" },
    ],
    models: [
      {
        id: "model-ce-fp160",
        modelName: "CE-FP160",
        specifications: [
          { label: "Gas Output", value: "160 L/H (Single Torch)" },
          { label: "Recommended Sheet Thickness", value: "1mm to 8mm" },
          { label: "Power", value: "600W 220V" },
        ],
        resources: [],
        consumables: [],
      },
      {
        id: "model-ce-fp260",
        modelName: "CE-FP260",
        specifications: [
          { label: "Gas Output", value: "260 L/H (Single or Dual Torch)" },
          { label: "Recommended Sheet Thickness", value: "1mm to 12mm" },
          { label: "Power", value: "1000W 220V" },
        ],
        resources: [],
        consumables: [],
      },
    ],
    resources: [],
    relatedConsumables: [],
    modelsSummary: "CE-FP160, CE-FP260",
    specsSummary:
      "Gas Output: 160 L/H to 260 L/H, Max Acrylic Thickness: Up to 12mm Curved & Internal Edges | CE-FP160: 160 L/H, 1mm to 8mm, 600W | CE-FP260: 260 L/H, 1mm to 12mm, 1000W",
    searchBlob:
      "hho oxy-hydrogen acrylic flame polishing machine ce-fp160 ce-fp260 160 l/h 260 l/h 12mm curved internal edges",
  },
  {
    id: "ce53-thermoforming-oven",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "Industrial Acrylic Sheet Thermoforming & Softening Oven",
    slug: "acrylic-thermoforming-oven",
    sku: "CE-TO1525",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "Hot-air circulation industrial baking and softening oven for uniform heating of full acrylic sheets prior to 3D dome blowing, drape molding, and curved podium forming.",
    features: [
      "Dual-convection hot-air circulation keeps temperature uniform within +/- 2 C",
      "Pull-out PTFE-coated drawers prevent surface marks on softened acrylic sheets",
      "Digital timer and PID temperature controller up to 250 C",
    ],
    specifications: [
      { label: "Chamber Size", value: "1500mm x 2500mm", type: "specification" },
      { label: "Temperature Control", value: "PID Digital (Room Temp to 250°C)", type: "specification" },
    ],
    models: [
      {
        id: "model-ce-to1525",
        modelName: "CE-TO1525",
        specifications: [
          { label: "Internal Chamber Size", value: "1500 x 2500 x 450 mm" },
          { label: "Heating Power", value: "18 kW 3-Phase" },
          { label: "Temperature Range", value: "Room Temp to 250°C" },
        ],
        resources: [],
        consumables: [],
      },
    ],
    resources: [],
    relatedConsumables: [],
    modelsSummary: "CE-TO1525",
    specsSummary:
      "Chamber Size: 1500mm x 2500mm, Temperature Control: PID Digital (Room Temp to 250°C), Heating Power: 18 kW 3-Phase",
    searchBlob:
      "industrial acrylic sheet thermoforming softening oven ce-to1525 1500x2500mm 250c 18 kw",
  },
  {
    id: "ce53-pcd-diamond-cutters",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "CONSUMABLE",
    name: "PCD & Natural Single-Crystal Diamond Polishing Cutters",
    slug: "pcd-natural-diamond-polishing-blades",
    sku: "CE-PCD-SET",
    categoryName: "Acrylic Fabrication Consumables & Tools",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/consumables",
    description:
      "Replacement pre-milling PCD and natural monocrystalline diamond finish cutters for YN-JW series acrylic diamond edge polishing machines.",
    specsSummary:
      "Compatibility: YN-JW1200, YN-JW1600 & Standard Edge Polishers, Blade Types: Roughing PCD + Finishing Natural Diamond",
    searchBlob:
      "pcd natural single-crystal diamond polishing cutters ce-pcd-set yn-jw1200 yn-jw1600 consumable blades",
  },
  {
    id: "ce53-acrylic-cnc-bits",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "CONSUMABLE",
    name: "Single-Flute Spiral Carbide CNC Router Bits for Acrylic",
    slug: "single-flute-acrylic-cnc-bits",
    sku: "CE-BIT-OFLUTE",
    categoryName: "Acrylic Fabrication Consumables & Tools",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/consumables",
    description:
      "Mirror-polished O-flute solid carbide spiral end mills designed for chip-free upward evacuation and smooth edge cutting on cast and extruded acrylic.",
    specsSummary: "Shank Sizes: 3.175mm, 4mm, 6mm, 8mm, Flute Geometry: Mirror-Polished O-Flute Upcut",
    searchBlob:
      "single-flute spiral carbide cnc router bits for acrylic ce-bit-oflute 3.175mm 4mm 6mm 8mm consumable",
  },
  {
    id: "ce53-chloroform-bonding-applicators",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "CONSUMABLE",
    name: "Bubble-Free Acrylic Solvent Bonding Glue & Needle Applicators",
    slug: "acrylic-bonding-solvent-applicators",
    sku: "CE-BOND-KIT",
    categoryName: "Acrylic Fabrication Consumables & Tools",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/consumables",
    description:
      "Optical-clarity capillary acrylic welding adhesive, UV curing crystal glue, and precision stainless-steel needle applicator bottles for invisible podium and display joints.",
    specsSummary: "Application: Capillary Seam Welding & Heavy Block Bonding",
    searchBlob:
      "bubble-free acrylic solvent bonding glue needle applicators ce-bond-kit capillary welding consumable",
  },
  {
    id: "ce53-buffing-wheels-compounds",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "CONSUMABLE",
    name: "Cotton Buffing Wheels, Heating Wires & Polishing Compounds",
    slug: "acrylic-buffing-wheels-heating-wires",
    sku: "CE-BUFF-KIT",
    categoryName: "Acrylic Fabrication Consumables & Tools",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/consumables",
    description:
      "Layered unbleached cotton buffing wheels, white/brown acrylic polishing wax bars, and replacement nichrome/quartz heating elements for acrylic line benders.",
    specsSummary: "Use Case: Final Gloss Buffing & Line Bender Maintenance",
    searchBlob:
      "cotton buffing wheels heating wires polishing compounds ce-buff-kit nichrome quartz consumable",
  },
];
