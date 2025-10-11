import { useState } from "react";
import { type Contact, type InsertContact } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

interface BulkDuplicateMatch {
  row: number;
  contact: InsertContact;
  duplicates: Contact[];
}

interface BulkDuplicateResolutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  duplicateMatches: BulkDuplicateMatch[];
  onResolve: (resolutions: Array<{ row: number; action: 'skip' | 'add' | 'override'; overrideId?: string }>) => void;
}

export function BulkDuplicateResolutionDialog({
  open,
  onOpenChange,
  duplicateMatches,
  onResolve,
}: BulkDuplicateResolutionDialogProps) {
  const [resolutions, setResolutions] = useState<Record<number, { action: 'skip' | 'add' | 'override'; overrideId?: string }>>({});

  const handleActionChange = (row: number, action: 'skip' | 'add' | 'override', overrideId?: string) => {
    setResolutions(prev => ({
      ...prev,
      [row]: { action, overrideId }
    }));
  };

  const handleResolve = () => {
    const resolutionArray = duplicateMatches.map(match => ({
      row: match.row,
      action: resolutions[match.row]?.action || 'skip',
      overrideId: resolutions[match.row]?.overrideId
    }));
    onResolve(resolutionArray);
    onOpenChange(false);
    setResolutions({});
  };

  const allResolved = duplicateMatches.every(match => resolutions[match.row]?.action);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh]" data-testid="dialog-bulk-duplicate-resolution">
        <DialogHeader>
          <DialogTitle data-testid="text-bulk-duplicate-title">
            Potential Duplicates Found ({duplicateMatches.length})
          </DialogTitle>
          <DialogDescription data-testid="text-bulk-duplicate-description">
            We found {duplicateMatches.length} contact{duplicateMatches.length > 1 ? 's' : ''} that may be duplicate{duplicateMatches.length > 1 ? 's' : ''}.
            Please choose how to handle each one.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] pr-4">
          <div className="space-y-6">
            {duplicateMatches.map((match, matchIndex) => (
              <div key={match.row} className="border rounded-lg p-4 space-y-3" data-testid={`card-bulk-duplicate-${matchIndex}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-blue-900 dark:text-blue-100" data-testid={`text-bulk-new-contact-${matchIndex}`}>
                      Row {match.row}: {match.contact.firstName} {match.contact.lastName}
                    </h4>
                    <p className="text-sm text-muted-foreground" data-testid={`text-bulk-new-contact-details-${matchIndex}`}>
                      {match.contact.email && `${match.contact.email} • `}
                      {match.contact.phone && `${match.contact.phone} • `}
                      {match.contact.company}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300" data-testid={`badge-bulk-duplicate-${matchIndex}`}>
                    {match.duplicates.length} Match{match.duplicates.length > 1 ? 'es' : ''}
                  </Badge>
                </div>

                <div className="space-y-2 pl-4 border-l-2 border-amber-200 dark:border-amber-800">
                  <p className="text-sm font-medium">Existing contacts:</p>
                  {match.duplicates.map((duplicate, dupIndex) => (
                    <div key={duplicate.id} className="text-sm text-muted-foreground" data-testid={`text-bulk-existing-${matchIndex}-${dupIndex}`}>
                      • {duplicate.firstName} {duplicate.lastName}
                      {duplicate.email && ` (${duplicate.email})`}
                      {duplicate.phone && ` - ${duplicate.phone}`}
                    </div>
                  ))}
                </div>

                <RadioGroup
                  value={resolutions[match.row]?.action || ''}
                  onValueChange={(value) => {
                    if (value === 'skip' || value === 'add') {
                      handleActionChange(match.row, value);
                    }
                  }}
                  data-testid={`radiogroup-action-${matchIndex}`}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="skip" id={`skip-${match.row}`} data-testid={`radio-skip-${matchIndex}`} />
                    <Label htmlFor={`skip-${match.row}`} className="cursor-pointer">Skip (don't import this contact)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="add" id={`add-${match.row}`} data-testid={`radio-add-${matchIndex}`} />
                    <Label htmlFor={`add-${match.row}`} className="cursor-pointer">Add as new contact anyway</Label>
                  </div>
                  {match.duplicates.map((duplicate, dupIndex) => (
                    <div key={duplicate.id} className="flex items-center space-x-2">
                      <RadioGroupItem
                        value={`override-${duplicate.id}`}
                        id={`override-${match.row}-${duplicate.id}`}
                        onClick={() => handleActionChange(match.row, 'override', duplicate.id)}
                        data-testid={`radio-override-${matchIndex}-${dupIndex}`}
                      />
                      <Label htmlFor={`override-${match.row}-${duplicate.id}`} className="cursor-pointer">
                        Replace: {duplicate.firstName} {duplicate.lastName}
                        {duplicate.email && ` (${duplicate.email})`}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-bulk-duplicates"
          >
            Cancel Import
          </Button>
          <Button
            onClick={handleResolve}
            disabled={!allResolved}
            data-testid="button-resolve-bulk-duplicates"
          >
            Continue Import ({duplicateMatches.filter(m => resolutions[m.row]?.action && resolutions[m.row].action !== 'skip').length} contacts)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
