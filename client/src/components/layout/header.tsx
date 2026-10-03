import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Bell, Search, Upload } from "lucide-react";

interface HeaderProps {
  title: string;
  onSearch?: (query: string) => void;
  searchValue?: string;
  wrapActions?: boolean;
  onAddNew?: () => void;
  onImport?: () => void;
  showAddButton?: boolean;
  showImportButton?: boolean;
  addButtonText?: string;
  customActions?: React.ReactNode;
}

export default function Header({ 
  title, 
  onSearch, 
  searchValue,
  wrapActions = false,
  onAddNew,
  onImport,
  showAddButton = true,
  showImportButton = false,
  addButtonText = "Add New",
  customActions
}: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    onSearch?.(value);
  };

  return (
    <header className={`bg-card border-b border-border px-6 py-4 flex justify-between gap-4 min-w-0 ${wrapActions ? "flex-col items-stretch xl:flex-row xl:items-center" : "items-center"}`} data-testid="header">
      <div className="flex items-center space-x-4 min-w-0 flex-shrink">
        <h2 className="text-2xl font-bold text-foreground whitespace-nowrap" data-testid="page-title">
          {title}
        </h2>
        <div className="relative hidden lg:block">
          <Input
            type="text"
            placeholder="Search..."
            className="w-48 xl:w-64 pl-10"
            value={searchValue ?? searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            data-testid="search-input"
          />
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        </div>
      </div>
      <div className={wrapActions ? "flex flex-wrap items-center gap-2 min-w-0 max-w-full [&>div]:max-w-full" : "flex items-center space-x-2 flex-shrink-0"}>
        <Button 
          variant="secondary" 
          data-testid="notifications-button"
        >
          <Bell className="h-4 w-4 mr-2" />
          Notifications
        </Button>
        {customActions}
        {showImportButton && (
          <Button 
            variant="outline"
            onClick={onImport}
            data-testid="button-import"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
        )}
        {showAddButton && (
          <Button 
            onClick={onAddNew}
            data-testid="add-new-button"
          >
            <Plus className="h-4 w-4 mr-2" />
            {addButtonText}
          </Button>
        )}
      </div>
    </header>
  );
}
