import Header from "@/components/layout/header";
import { SalonFormOutreachPanel } from "@/components/salon-form-outreach-panel";

export default function FormOutreach() {
  return <div className="flex-1 overflow-y-auto">
    <Header title="Form Outreach" />
    <main className="p-6 max-w-[1100px] mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Contact-form review queue</h1>
      <SalonFormOutreachPanel />
    </main>
  </div>;
}