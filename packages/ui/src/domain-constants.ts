export const WHATSAPP_PUBLIC_DOMAIN = "chat.ccapl.cc";
export const WHATSAPP_PUBLIC_ORIGIN = "https://chat.ccapl.cc";
export const SHORTLINK_PUBLIC_DOMAIN = "ccapl.cc";
export const SHORTLINK_PUBLIC_ORIGIN = "https://ccapl.cc";
export const TRACKING_PUBLIC_DOMAIN = "track.ccapl.cc";
export const TRACKING_PUBLIC_ORIGIN = "https://track.ccapl.cc";
export const TRACKING_SECONDARY_DOMAIN = "track.ccapl.in";

export interface ShippingProviderOption {
  code: string;
  name: string;
  urlTemplate: string;
  placeholder: string;
}

export const SHIPPING_PROVIDER_OPTIONS: ShippingProviderOption[] = [
  {
    code: "DELHIVERY",
    name: "Delhivery",
    urlTemplate: "https://www.delhivery.com/track/package/{awb}",
    placeholder: "AWB / Waybill e.g. 1490827364512",
  },
  {
    code: "BLUEDART",
    name: "Blue Dart",
    urlTemplate: "https://www.bluedart.com/tracking?trackFor=0&trackNo={awb}",
    placeholder: "Waybill e.g. 76901234811",
  },
  {
    code: "SAFEEXPRESS",
    name: "Safexpress",
    urlTemplate: "https://www.safexpress.com/track?waybill={awb}",
    placeholder: "Waybill / LR No. e.g. SFX99201844",
  },
  {
    code: "DTDC",
    name: "DTDC",
    urlTemplate: "https://www.dtdc.in/trace.asp?strCnno={awb}",
    placeholder: "Consignment No. e.g. D82910442",
  },
  {
    code: "VRL",
    name: "VRL Logistics",
    urlTemplate: "https://www.vrlgroup.in/track_consignment.aspx?lrno={awb}",
    placeholder: "LR No. e.g. 1092837465",
  },
  {
    code: "TCIEXPRESS",
    name: "TCI Express",
    urlTemplate: "https://www.tciexpress.in/trackingdocket.asp?docketno={awb}",
    placeholder: "Docket No. e.g. 492018372",
  },
  {
    code: "GATI",
    name: "Gati KWE",
    urlTemplate: "https://www.gati.com/track-by-docket/?dktno={awb}",
    placeholder: "Docket No. e.g. 381920411",
  },
  {
    code: "TRACKON",
    name: "Trackon",
    urlTemplate: "https://trackon.in/Tracking/TrackConsignment?awb={awb}",
    placeholder: "AWB No. e.g. 5002918273",
  },
  {
    code: "SHIPROCKET",
    name: "Shiprocket",
    urlTemplate: "https://shiprocket.co/tracking/{awb}",
    placeholder: "AWB / Tracking ID",
  },
  {
    code: "DHL",
    name: "DHL Express",
    urlTemplate: "https://www.dhl.com/in-en/home/tracking.html?tracking-id={awb}",
    placeholder: "DHL Waybill Number",
  },
  {
    code: "FEDEX",
    name: "FedEx",
    urlTemplate: "https://www.fedex.com/fedextrack/?trknbr={awb}",
    placeholder: "FedEx Tracking Number",
  },
  {
    code: "INDIAPOST",
    name: "India Post",
    urlTemplate:
      "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx",
    placeholder: "Consignment No. e.g. EE123456789IN",
  },
  {
    code: "PORTER",
    name: "Porter / Local Tempo",
    urlTemplate: "",
    placeholder: "Trip ID or Driver Ref",
  },
  {
    code: "CUSTOM",
    name: "Other Courier / Direct Link",
    urlTemplate: "",
    placeholder: "Consignment / Reference No.",
  },
];
