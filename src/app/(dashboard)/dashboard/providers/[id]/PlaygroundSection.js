"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Card, ProbeSection } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { usePlaygroundApiKey } from "./usePlaygroundApiKey";
import PlaygroundTestTab from "./PlaygroundTestTab";
import PlaygroundCompareTab from "./PlaygroundCompareTab";

/**
 * Container tab Playground provider.
 *
 * Struktur TABS config-driven agar tab baru (mis. "Probe LLM", ide #5c)
 * tinggal ditambah sebagai entri { id, label, Component } tanpa mengubah
 * container ini. API key di-load sekali di sini lalu di-pass ke semua tab.
 */
const TABS = [
  { id: "test", label: "Test", Component: PlaygroundTestTab },
  { id: "compare", label: "Compare", Component: PlaygroundCompareTab },
  { id: "probe", label: "Probe", Component: ProbeSection },
];

export default function PlaygroundSection({ providerId, providerAlias, models, customModels, disabledModelIds, connections }) {
  const [activeTab, setActiveTab] = useState("test");
  const apiKey = usePlaygroundApiKey();

  const ActiveTab = TABS.find((t) => t.id === activeTab)?.Component || PlaygroundTestTab;
  const tabProps = { providerId, providerAlias, models, customModels, disabledModelIds, connections, apiKey };

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">{translate("Playground")}</h2>
        <div className="flex gap-1 rounded-lg border border-border p-1 self-start" role="tablist" aria-label={translate("Playground")}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                activeTab === id
                  ? "bg-primary/15 text-text-main font-medium"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              {translate(label)}
            </button>
          ))}
        </div>
      </div>

      <ActiveTab {...tabProps} />
    </Card>
  );
}

PlaygroundSection.propTypes = {
  providerId: PropTypes.string.isRequired,
  providerAlias: PropTypes.string.isRequired,
  models: PropTypes.arrayOf(PropTypes.object),
  customModels: PropTypes.arrayOf(PropTypes.object),
  disabledModelIds: PropTypes.arrayOf(PropTypes.string),
  connections: PropTypes.arrayOf(PropTypes.object),
};
