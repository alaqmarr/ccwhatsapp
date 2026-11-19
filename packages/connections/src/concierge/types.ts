import type {
  buildEcosystemDeepProductContextAndAnswer,
  buildMultiItemProjectPlan,
  getVerifiedLiveBrandAndTeamInfo,
} from "@cc/database";

export type MultiItemProjectPlan = ReturnType<typeof buildMultiItemProjectPlan>;
export type DeepProductContextResult = ReturnType<
  typeof buildEcosystemDeepProductContextAndAnswer
>;
export type LiveBrandTeamDirectory = Awaited<
  ReturnType<typeof getVerifiedLiveBrandAndTeamInfo>
>;
