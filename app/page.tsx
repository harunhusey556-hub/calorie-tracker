"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import BottomNav, { type Tab } from "@/components/BottomNav";
import LogScreen from "@/components/LogScreen";
import TodayScreen from "@/components/TodayScreen";
import HistoryScreen from "@/components/HistoryScreen";
import SettingsScreen from "@/components/SettingsScreen";

export default function Home() {
  const [tab, setTab] = useState<Tab>("today");
  const [refreshKey, setRefreshKey] = useState(0);

  function bump() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-black pb-24">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ type: "spring", stiffness: 340, damping: 32 }}
        >
          {tab === "today" && <TodayScreen refreshKey={refreshKey} />}
          {tab === "log" && (
            <LogScreen
              onSaved={() => {
                bump();
                setTab("today");
              }}
            />
          )}
          {tab === "history" && <HistoryScreen refreshKey={refreshKey} />}
          {tab === "settings" && <SettingsScreen onSaved={bump} />}
        </motion.div>
      </AnimatePresence>

      <BottomNav active={tab} onChange={setTab} />
    </main>
  );
}
