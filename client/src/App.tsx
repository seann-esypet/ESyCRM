import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Contacts from "@/pages/contacts";
import Deals from "@/pages/deals";
import Tasks from "@/pages/tasks";
import Reports from "@/pages/reports";
import Commissions from "@/pages/commissions";
import EmailSequences from "@/pages/email-sequences";
import Inbox from "@/pages/inbox";
import Settings from "@/pages/settings";
import Sidebar from "@/components/layout/sidebar";

// From Replit Auth blueprint - Conditional routing based on auth state
function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show landing page for unauthenticated users
  if (isLoading || !isAuthenticated) {
    return <Landing />;
  }

  // Show authenticated app with sidebar
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/contacts" component={Contacts} />
          <Route path="/deals" component={Deals} />
          <Route path="/tasks" component={Tasks} />
          <Route path="/email-sequences" component={EmailSequences} />
          <Route path="/inbox" component={Inbox} />
          <Route path="/commissions" component={Commissions} />
          <Route path="/reports" component={Reports} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
