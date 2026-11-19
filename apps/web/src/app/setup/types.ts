export type SetupMode = "SANDBOX_SIMULATOR" | "LIVE_META_CLOUD";

export interface SetupStepsCompleted {
  metaBusinessVerified: boolean;
  whatsappAppCreated: boolean;
  phoneRegistered: boolean;
  webhookSubscribed: boolean;
  systemTokenSaved: boolean;
}

export interface SetupStateResponse {
  hasDevAccount: boolean;
  allFacebookStepsDone: boolean;
  facebookConfig: {
    mode: SetupMode;
    businessPortfolioId?: string;
    verifiedName?: string;
    metaAppId: string;
    metaAppSecret: string;
    wabaId: string;
    phoneNumberId: string;
    businessDisplayPhone: string;
    systemUserAccessToken: string;
    webhookVerifyToken: string;
    stepsCompleted: SetupStepsCompleted;
  };
  currentUser: { id: string; name: string; role: string } | null;
  aiConnected?: boolean;
  aiMaskedKey?: string;
  aiKeys?: {
    clientConnected: boolean;
    clientSource: string;
    clientMasked: string;
    adminConnected: boolean;
    adminSource: string;
    adminMasked: string;
  };
}

export const FACEBOOK_CHECKLIST_ITEMS: Array<{
  key: keyof SetupStepsCompleted;
  title: string;
  desc: string;
}> = [
  {
    key: "metaBusinessVerified",
    title: "1. Verify Classic Concepts Business Account on Facebook",
    desc: "Upload GST certificate in business.facebook.com under Business Info.",
  },
  {
    key: "whatsappAppCreated",
    title: "2. Create a Business App on developers.facebook.com",
    desc: "Add the WhatsApp product inside your Facebook app.",
  },
  {
    key: "phoneRegistered",
    title: "3. Connect Official Classic Concepts Phone Number",
    desc: "Verify the phone number by SMS or phone call and copy the Phone Number ID.",
  },
  {
    key: "systemTokenSaved",
    title: "4. Create a Permanent System User Token",
    desc: "In Business Settings -> System Users, generate a permanent token with WhatsApp messaging access.",
  },
  {
    key: "webhookSubscribed",
    title: "5. Connect Webhook to chat.ccapl.cc",
    desc: "Paste the Callback URL and Verify Token on the left, then turn on the 'messages' toggle.",
  },
];
