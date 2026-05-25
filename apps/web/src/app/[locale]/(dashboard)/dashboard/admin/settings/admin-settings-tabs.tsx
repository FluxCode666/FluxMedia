"use client";

import { useState } from "react";

import { SystemSettingsPanel } from "@repo/shared/system-settings/components";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";

import { ImageBackendPoolAdminPanel } from "@/features/image-backend-pool";

type AdminSettingsTabsProps = {
  timeZone: string;
};

export function AdminSettingsTabs({ timeZone }: AdminSettingsTabsProps) {
  const [activeTab, setActiveTab] = useState("system");

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="h-auto flex-wrap justify-start bg-transparent p-0">
        <TabsTrigger
          value="system"
          className="rounded-md border border-transparent px-3 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground/5 data-[state=active]:text-foreground data-[state=active]:shadow-none"
        >
          系统设置
        </TabsTrigger>
        <TabsTrigger
          value="image-backends"
          className="rounded-md border border-transparent px-3 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground/5 data-[state=active]:text-foreground data-[state=active]:shadow-none"
        >
          生图后端池
        </TabsTrigger>
      </TabsList>
      <TabsContent value="system" className="mt-6">
        {activeTab === "system" ? <SystemSettingsPanel /> : null}
      </TabsContent>
      <TabsContent value="image-backends" className="mt-6">
        {activeTab === "image-backends" ? (
          <ImageBackendPoolAdminPanel timeZone={timeZone} />
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
