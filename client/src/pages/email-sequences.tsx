import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Mail, Edit, CheckCircle, XCircle } from "lucide-react";
import type { EmailSequence } from "@shared/schema";
import EmailSequenceForm from "@/components/email-sequences/email-sequence-form";

export default function EmailSequences() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedSequence, setSelectedSequence] = useState<EmailSequence | undefined>();

  const { data: sequences, isLoading } = useQuery<EmailSequence[]>({
    queryKey: ["/api/email-sequences"],
  });

  const handleEdit = (sequence: EmailSequence) => {
    setSelectedSequence(sequence);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedSequence(undefined);
  };

  // Map sequences by number for display
  const sequenceMap = new Map<number, EmailSequence>();
  sequences?.forEach(seq => {
    sequenceMap.set(seq.sequenceNumber, seq);
  });

  // Generate all 5 sequences (existing or empty)
  const allSequences = [1, 2, 3, 4, 5].map(num => sequenceMap.get(num));

  return (
    <>
      <Header 
        title="Email Sequences" 
        showAddButton={false}
      />
      
      <main className="flex-1 overflow-y-auto p-6 bg-muted/30" data-testid="email-sequences-content">
        <div className="max-w-6xl mx-auto">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Sequence</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Subject</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Schedule Rule</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Status</th>
                    <th className="text-right px-6 py-4 text-sm font-semibold text-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                        Loading sequences...
                      </td>
                    </tr>
                  ) : (
                    allSequences.map((sequence, index) => {
                      const sequenceNumber = index + 1;
                      const scheduleText = sequence
                        ? sequenceNumber === 1 
                          ? `Send on ${sequence.scheduledDate ? new Date(sequence.scheduledDate).toLocaleDateString() : 'Not set'} at ${sequence.scheduledTime || 'Not set'}`
                          : `${sequence.daysAfterNoReply || 0} days after no reply to Sequence ${sequenceNumber - 1}`
                        : sequenceNumber === 1
                        ? "Not configured"
                        : `After Sequence ${sequenceNumber - 1}`;

                      return (
                        <tr 
                          key={sequenceNumber} 
                          className="hover:bg-muted/50 transition-colors"
                          data-testid={`row-sequence-${sequenceNumber}`}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                sequence?.isActive === "true" ? "bg-primary" : "bg-muted"
                              }`}>
                                <Mail className={`h-5 w-5 ${
                                  sequence?.isActive === "true" ? "text-primary-foreground" : "text-muted-foreground"
                                }`} />
                              </div>
                              <span className="font-semibold text-foreground">
                                Sequence {sequenceNumber}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-sm text-foreground" data-testid={`text-subject-${sequenceNumber}`}>
                              {sequence?.subject || "Not configured"}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-sm text-muted-foreground" data-testid={`text-schedule-${sequenceNumber}`}>
                              {scheduleText}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {sequence?.isActive === "true" ? (
                              <div className="flex items-center space-x-2 text-green-600 dark:text-green-400">
                                <CheckCircle className="h-4 w-4" />
                                <span className="text-sm font-medium" data-testid={`status-active-${sequenceNumber}`}>Active</span>
                              </div>
                            ) : (
                              <div className="flex items-center space-x-2 text-muted-foreground">
                                <XCircle className="h-4 w-4" />
                                <span className="text-sm font-medium" data-testid={`status-inactive-${sequenceNumber}`}>Inactive</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (sequence) {
                                  handleEdit(sequence);
                                } else {
                                  setSelectedSequence({ sequenceNumber } as EmailSequence);
                                  setIsFormOpen(true);
                                }
                              }}
                              data-testid={`button-edit-${sequenceNumber}`}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              {sequence ? "Edit" : "Configure"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">How Email Sequences Work</h3>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>• Sequences automatically send to contacts marked as "Qualified Lead"</li>
              <li>• Sequence 1 sends on your chosen date and time</li>
              <li>• Sequences 2-5 send automatically after specified days if no reply received</li>
              <li>• Use placeholders: [Contact_First_Name], [Sales_Person] in your email content</li>
              <li>• Requires Reserved VM deployment for 24/7 automation</li>
            </ul>
          </div>
        </div>
      </main>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedSequence?.id ? `Edit Sequence ${selectedSequence.sequenceNumber}` : `Configure Sequence ${selectedSequence?.sequenceNumber || 1}`}
            </DialogTitle>
          </DialogHeader>
          <EmailSequenceForm
            sequence={selectedSequence}
            onSuccess={handleFormClose}
            onCancel={handleFormClose}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
