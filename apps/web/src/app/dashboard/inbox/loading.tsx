import React from "react";
import {
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
  ChatMessagesSkeleton,
  ChatThreadListSkeleton,
  RightDrawerSkeleton,
} from "@cc/ui";

export default function InboxLoading() {
  return (
    <div className="h-[calc(100dvh-52px)] lg:h-full w-full flex overflow-hidden bg-[#f0f2f5]">
      <div className="w-full lg:w-[340px] xl:w-[375px] shrink-0 border-r border-[#d1d7db] bg-white flex flex-col">
        <div className="h-[58px] px-4 bg-[#f0f2f5] border-b border-[#d1d7db] flex items-center">
          <div className="h-5 w-36 rounded bg-neutral-200/80 animate-pulse" />
        </div>
        <ChatThreadListSkeleton count={7} />
      </div>
      <div
        style={CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE}
        className="hidden lg:flex flex-1 min-w-0 flex-col justify-center"
      >
        <ChatMessagesSkeleton />
      </div>
      <div className="hidden xl:block w-[330px] shrink-0 border-l border-[#d1d7db] bg-white p-4">
        <RightDrawerSkeleton />
      </div>
    </div>
  );
}
