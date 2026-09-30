"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Card } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import ConsoleLogsTab from "./ConsoleLogsTab";
import ReplayTab from "./ReplayTab";

/**
 * Container tab Console Log.
 *
 * Struktur TABS config-driven agar tab baru tinggal ditambah sebagai entri
 * { id, label, Component } tanpa mengubah container ini.
 */
const TABS = [
  { id: "logs", label: "Logs", Component: ConsoleLogsTab },
  { id: "replay", label: "Replay", Component: ReplayTab },
];

function TabButton({ id, label, active, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onClick(id)}
      className={`rounded-md px-3 py-1 text-sm transition-colors ${
        active
          ? "bg-primary/15 text-text-main font-medium"
          : "text-text-muted hover:text-text-main"
      }`}
    >
      {translate(label)}
    </button>
  );
}

TabButton.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  active: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
};

export default function ConsoleLogClient() {
  const [activeTab, setActiveTab] = useState("logs");

  const ActiveTab = TABS.find((t) => t.id === activeTab)?.Component || ConsoleLogsTab;

  return (
    <Card>
      <div className="flex items-center gap-1 border-b border-border px-4 pt-3 pb-2" role="tablist" aria-label={translate("Console Log")}>
        {TABS.map(({ id, label }) => (
          <TabButton key={id} id={id} label={label} active={activeTab === id} onClick={setActiveTab} />
        ))}
      </div>
      <ActiveTab />
    </Card>
  );
}
