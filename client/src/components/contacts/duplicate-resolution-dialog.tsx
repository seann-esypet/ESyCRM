import { type Contact } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

interface DuplicateResolutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  duplicates: Contact[];
  newContact: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    jobTitle?: string | null;
    notes?: string | null;
  };
  onAddAnyway: () => void;
  onOverride: (contactId: string) => void;
  onCancel: () => void;
}

export function DuplicateResolutionDialog({
  open,
  onOpenChange,
  duplicates,
  newContact,
  onAddAnyway,
  onOverride,
  onCancel,
}: DuplicateResolutionDialogProps) {
  const handleCancel = () => {
    onCancel();
    onOpenChange(false);
  };

  const handleAddAnyway = () => {
    onAddAnyway();
    onOpenChange(false);
  };

  const handleOverride = (contactId: string) => {
    onOverride(contactId);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-duplicate-resolution">
        <AlertDialogHeader>
          <AlertDialogTitle data-testid="text-duplicate-title">
            Potential Duplicate Contact Found
          </AlertDialogTitle>
          <AlertDialogDescription data-testid="text-duplicate-description">
            We found {duplicates.length} existing contact{duplicates.length > 1 ? 's' : ''} that may be {duplicates.length > 1 ? 'duplicates' : 'a duplicate'}. 
            Please review and choose how to proceed.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 my-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
            <h4 className="font-semibold mb-2 text-blue-900 dark:text-blue-100" data-testid="text-new-contact-title">New Contact:</h4>
            <div className="text-sm space-y-1 text-blue-800 dark:text-blue-200">
              <p data-testid="text-new-contact-name"><strong>Name:</strong> {newContact.firstName} {newContact.lastName}</p>
              {newContact.email && <p data-testid="text-new-contact-email"><strong>Email:</strong> {newContact.email}</p>}
              {newContact.phone && <p data-testid="text-new-contact-phone"><strong>Phone:</strong> {newContact.phone}</p>}
              {newContact.company && <p data-testid="text-new-contact-company"><strong>Company:</strong> {newContact.company}</p>}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold" data-testid="text-existing-contacts-title">Existing Contact{duplicates.length > 1 ? 's' : ''}:</h4>
            {duplicates.map((duplicate, index) => (
              <div 
                key={duplicate.id} 
                className="p-4 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-200 dark:border-amber-800"
                data-testid={`card-duplicate-${index}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <h5 className="font-medium text-amber-900 dark:text-amber-100" data-testid={`text-duplicate-name-${index}`}>
                    {duplicate.firstName} {duplicate.lastName}
                  </h5>
                  <Badge variant="outline" className="text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700" data-testid={`badge-duplicate-${index}`}>
                    Match
                  </Badge>
                </div>
                <div className="text-sm space-y-1 text-amber-800 dark:text-amber-200">
                  {duplicate.email && <p data-testid={`text-duplicate-email-${index}`}><strong>Email:</strong> {duplicate.email}</p>}
                  {duplicate.phone && <p data-testid={`text-duplicate-phone-${index}`}><strong>Phone:</strong> {duplicate.phone}</p>}
                  {duplicate.company && <p data-testid={`text-duplicate-company-${index}`}><strong>Company:</strong> {duplicate.company}</p>}
                </div>
                <button
                  onClick={() => handleOverride(duplicate.id)}
                  className="mt-3 text-sm font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline"
                  data-testid={`button-override-${index}`}
                >
                  Replace this contact with new information
                </button>
              </div>
            ))}
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel} data-testid="button-cancel-duplicate">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleAddAnyway} data-testid="button-add-anyway">
            Add as New Contact Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
