import {
  cleanDisplayProductName,
  type MainWebsiteProduct,
} from "./catalog-types";

let cachedDirectoryKey = "";
let cachedDirectoryText = "";

export function buildCompleteEcosystemDatabaseDirectory(
  allItems: MainWebsiteProduct[]
): string {
  const key = `${allItems.length}:${allItems[0]?.id || ""}:${allItems[allItems.length - 1]?.id || ""}`;
  if (cachedDirectoryKey === key && cachedDirectoryText) {
    return cachedDirectoryText;
  }

  const ccProducts = allItems.filter((i) => i.brand === "CLASSIC_CONCEPTS");
  const ceMachines = allItems.filter(
    (i) => i.brand === "CLASSIC_EDGE_53" && i.itemType === "MACHINE"
  );
  const ceConsumables = allItems.filter(
    (i) => i.brand === "CLASSIC_EDGE_53" && i.itemType === "CONSUMABLE"
  );

  const podiums = ccProducts.filter(
    (p) =>
      /\b(podium|lectern|pulpit|rostrum)\b|^ccp\d/i.test(
        `${p.name} ${p.categoryName} ${p.sku || ""}`
      )
  );
  const otherCcProducts = ccProducts.filter((p) => !podiums.includes(p));

  const lines: string[] = [];
  lines.push(
    `COMPLETE VERIFIED ECOSYSTEM CATALOG DIRECTORY (${allItems.length} total items: ${ccProducts.length} Classic Concepts products, ${ceMachines.length} Classic Edge 53 machines, ${ceConsumables.length} consumables & acrylic hardware accessories):`
  );

  lines.push(
    `\n[A] ALL ${podiums.length} ACRYLIC & WOOD STAGE PODIUMS / PULPITS / LECTERNS (EXACT SIZES, PRICES & LINKS):`
  );
  for (const p of podiums) {
    const cleanTitle = cleanDisplayProductName(p.name);
    const skuTag = p.sku ? ` [${p.sku}]` : "";
    const priceTag = p.basePrice
      ? `₹${p.basePrice.toLocaleString("en-IN")}`
      : "Quote";
    const dimSummary =
      (p.dimensions || [])
        .slice(0, 2)
        .map((d) => `${d.label || d.key}:${d.value}`)
        .join(", ") || "";
    const varSummary =
      p.variants && p.variants.length > 0
        ? ` | Vars:${p.variants
            .slice(0, 4)
            .map((v) =>
              v.price ? `${v.name}(₹${v.price.toLocaleString("en-IN")})` : v.name
            )
            .join(",")}`
        : "";
    lines.push(
      `- ${cleanTitle}${skuTag} | ${priceTag}${dimSummary ? ` | ${dimSummary}` : ""}${varSummary} | ${p.shortUrl || p.url}`
    );
  }

  lines.push(
    `\n[B] ALL ${ceMachines.length} CLASSIC EDGE 53 INDUSTRIAL ACRYLIC MACHINES (MODELS, SPECS & LINKS):`
  );
  for (const m of ceMachines) {
    const cleanTitle = cleanDisplayProductName(m.name);
    const priceTag = m.basePrice
      ? `from ₹${m.basePrice.toLocaleString("en-IN")}`
      : "Quote";
    const modelsTag = m.modelsSummary ? ` | Models:${m.modelsSummary}` : "";
    const specsTag = (m.specifications || [])
      .slice(0, 3)
      .map((s) => `${s.label || s.key}:${s.value}`)
      .join(",");
    lines.push(
      `- ${cleanTitle} | ${priceTag}${modelsTag}${specsTag ? ` | ${specsTag}` : ""} | ${m.shortUrl || m.url}`
    );
  }

  const machineConsumables = ceConsumables.filter(
    (c) => !/accessories/i.test(c.categoryName)
  );
  const acrylicAccessories = ceConsumables.filter((c) =>
    /accessories/i.test(c.categoryName)
  );

  lines.push(
    `\n[C] CLASSIC EDGE 53 MACHINE CONSUMABLES & TOOLS (${machineConsumables.length} items):`
  );
  for (const c of machineConsumables) {
    const priceTag = c.basePrice
      ? `₹${c.basePrice.toLocaleString("en-IN")}`
      : "Quote";
    lines.push(
      `- ${cleanDisplayProductName(c.name)} | ${priceTag} | ${c.shortUrl || c.url}`
    );
  }

  lines.push(
    `\n[D] PODIUM OPTIONAL ADD-ONS & ${acrylicAccessories.length} ACRYLIC HARDWARE ACCESSORIES / SPECIALTY SHEETS:`
  );
  lines.push(
    `- Standard Podium Add-Ons: Customized Acrylic Logo Plate, Warm Light Profile (LED backlit), Wireless Collar & Handheld Mics, Podium Cover, Heavy-Duty Castor Wheels, Hard Flight Case.`
  );
  for (const acc of acrylicAccessories) {
    const priceTag = acc.basePrice
      ? `₹${acc.basePrice.toLocaleString("en-IN")}`
      : "Quote";
    lines.push(
      `- ${cleanDisplayProductName(acc.name)} | ${priceTag} | ${acc.shortUrl || acc.url}`
    );
  }

  lines.push(
    `\n[E] ALL OTHER CLASSIC CONCEPTS READY ACRYLIC PRODUCTS (${otherCcProducts.length} items across Awards, Hotel/Menu Stands, Boxes, Retail Risers, Furniture, Religious & Cast Sheets):`
  );
  for (const p of otherCcProducts) {
    const cleanTitle = cleanDisplayProductName(p.name);
    const skuTag = p.sku ? ` [${p.sku}]` : "";
    const priceTag = p.basePrice
      ? `₹${p.basePrice.toLocaleString("en-IN")}`
      : "Quote";
    const sizeTag =
      p.dimensions && p.dimensions.length > 0
        ? ` | ${p.dimensions
            .slice(0, 2)
            .map((d) => `${d.label || d.key}:${d.value}`)
            .join(",")}`
        : "";
    lines.push(
      `- [${p.categoryName}] ${cleanTitle}${skuTag} | ${priceTag}${sizeTag} | ${p.shortUrl || p.url}`
    );
  }

  cachedDirectoryKey = key;
  cachedDirectoryText = lines.join("\n");
  return cachedDirectoryText;
}
