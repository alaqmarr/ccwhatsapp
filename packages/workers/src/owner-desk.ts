export type {
  LeadItem,
  LeadItemKind,
  LogAssignmentFn,
  ParsedAssignCommand,
} from "./owner-desk/types";

export {
  buildOwnerStaffProfile,
  getOwnerWhatsAppNumbers,
  isOwnerWhatsAppPhone,
  parseAssignCommand,
} from "./owner-desk/identity-and-parse";

export { deleteLeadForwardsForTest } from "./owner-desk/desk-data";

export { flushPendingLeadForwards } from "./owner-desk/lead-delivery";

export { assignLeadFromOwner } from "./owner-desk/lead-assign";

export {
  countPendingLeadForwards,
  handleStaffDeskMessage,
  isStaffGreeting,
} from "./owner-desk/staff-desk";

export { handleOwnerReadCommand } from "./owner-desk/owner-commands";

export { handleOwnerDeskMessage } from "./owner-desk/desk-router";
