export type {
  AccidentalCustomerReplyMetadata,
  MentionableStaff,
  MissingCompanyDocPrompt,
  NoteAttachmentPayload,
  PendingAcrioCandidateOption,
  PendingAcrioNoteAction,
  StaffNotification,
} from "./staff-notes/types";

export {
  createNotification,
  ensureStaffNotificationsTable,
  listStaffNotifications,
  markStaffNotificationsRead,
  notifyCallbackRequest,
  parseNoteMentions,
} from "./staff-notes/notifications";

export {
  executeAcrioPendingNoteAction,
  promoteMissingDocNoteToPendingAction,
} from "./staff-notes/pending-actions";

export {
  claimAndRunStaffNoteJobs,
  requeueStaleStaffNoteJobs,
  runStaffNoteAnswerJob,
} from "./staff-notes/acrio-note-ai";

export {
  buildSmartCorrectedReplyOption,
  convertInternalNoteToCustomerMessage,
  detectAccidentalCustomerReplyInNote,
} from "./staff-notes/accidental-reply";

export { processStaffNote } from "./staff-notes/note-processor";
