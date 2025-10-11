import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Bell, Search, Upload } from "lucide-react";

interface HeaderProps {
  title: string;
  onSearch?: (query: string) => void;
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
    <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between" data-testid="header">
      <div className="flex items-center space-x-4">
        <h2 className="text-2xl font-bold text-foreground" data-testid="page-title">
          {title}
        </h2>
        <div className="relative">
          <Input
            type="text"
            placeholder="Search contacts, deals, or tasks..."
            className="w-80 pl-10"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            data-testid="search-input"
          />
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        </div>
      </div>
      <div className="flex items-center space-x-3">
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
