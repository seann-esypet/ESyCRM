import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Edit, CheckCircle, XCircle, Users, Plus } from "lucide-react";
import type { EmailSequence, EmailSequenceLog } from "@shared/schema";
import EmailSequenceForm from "@/components/email-sequences/email-sequence-form";
import AddContactsToSequenceDialog from "@/components/email-sequences/add-contacts-to-sequence-dialog";

type SequenceTrack = "no_software" | "uses_competitor";

export default function EmailSequences() {
  const [activeTrack, setActiveTrack] = useState<SequenceTrack>("no_software");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedSequence, setSelectedSequence] = useState<EmailSequence | undefined>();
  const [isAddContactsOpen, setIsAddContactsOpen] = useState(false);
  const [sequenceForContacts, setSequenceForContacts] = useState<EmailSequence | undefined>();

  const { data: noSoftwareSequences, isLoading: isLoadingNoSoftware } = useQuery<EmailSequence[]>({
    queryKey: ["/api/email-sequences?track=no_software"],
  });

  const { data: competitorSequences, isLoading: isLoadingCompetitor } = useQuery<EmailSequence[]>({
    queryKey: ["/api/email-sequences?track=uses_competitor"],
  });

  const { data: logs, isLoading: isLogsLoading, isError: isLogsError } = useQuery<EmailSequenceLog[]>({
    queryKey: ["/api/email-sequence-logs"],
  });

  const handleEdit = (sequence: EmailSequence) => {
    setSelectedSequence(sequence);
    setIsFormOpen(true);
  };

  const handleCreateNew = (sequenceNumber: number, track: SequenceTrack) => {
    setSelectedSequence({ sequenceNumber, sequenceTrack: track } as EmailSequence);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedSequence(undefined);
  };

  const handleAddContacts = (sequence: EmailSequence) => {
    setSequenceForContacts(sequence);
    setIsAddContactsOpen(true);
  };

  const getQueueCount = (sequenceId: string | undefined) => {
    if (!sequenceId) return null;
    if (!logs) return null;
    return logs.filter(log => 
      log.sequenceId === sequenceId && 
      (log.status === "pending" || log.status === "processing")
    ).length;
  };

  const renderSequenceTable = (sequences: EmailSequence[] | undefined, isLoading: boolean, track: SequenceTrack) => {
    const sequenceMap = new Map<number, EmailSequence>();
    sequences?.forEach(seq => {
      sequenceMap.set(seq.sequenceNumber, seq);
    });

    const allSequences = [1, 2, 3, 4, 5].map(num => sequenceMap.get(num));

    return (
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Sequence</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Subject</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Schedule Rule</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Status</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Queue</th>
                <th className="text-right px-6 py-4 text-sm font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
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
                      data-testid={`row-sequence-${track}-${sequenceNumber}`}
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
                        <span className="text-sm text-foreground" data-testid={`text-subject-${track}-${sequenceNumber}`}>
                          {sequence?.subject || "Not configured"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-muted-foreground" data-testid={`text-schedule-${track}-${sequenceNumber}`}>
                          {scheduleText}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {sequence?.isActive === "true" ? (
                          <div className="flex items-center space-x-2 text-green-600 dark:text-green-400">
                            <CheckCircle className="h-4 w-4" />
                            <span className="text-sm font-medium" data-testid={`status-active-${track}-${sequenceNumber}`}>Active</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2 text-muted-foreground">
                            <XCircle className="h-4 w-4" />
                            <span className="text-sm font-medium" data-testid={`status-inactive-${track}-${sequenceNumber}`}>Inactive</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {sequence ? (
                          <div className="flex items-center space-x-2">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium" data-testid={`queue-count-${track}-${sequenceNumber}`}>
                              {isLogsLoading ? (
                                "Loading..."
                              ) : isLogsError ? (
                                <span className="text-destructive">Error</span>
                              ) : (
                                `${getQueueCount(sequence.id) ?? 0} queued`
                              )}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (sequence) {
                                handleEdit(sequence);
                              } else {
                                handleCreateNew(sequenceNumber, track);
                              }
                            }}
                            data-testid={`button-edit-${track}-${sequenceNumber}`}
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            {sequence ? "Edit" : "Configure"}
                          </Button>
                          {sequence && sequence.isActive === "true" && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleAddContacts(sequence)}
                              data-testid={`button-add-contacts-${track}-${sequenceNumber}`}
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Contacts
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    );
  };

  return (
    <>
      <Header 
        title="Email Sequences" 
        showAddButton={false}
      />
      
      <main className="flex-1 overflow-y-auto p-6 bg-muted/30" data-testid="email-sequences-content">
        <div className="max-w-6xl mx-auto">
          <Tabs value={activeTrack} onValueChange={(v) => setActiveTrack(v as SequenceTrack)} className="space-y-6">
            <TabsList className="grid w-full grid-cols-2 max-w-md">
              <TabsTrigger value="no_software" data-testid="tab-no-software">
                No Software
              </TabsTrigger>
              <TabsTrigger value="uses_competitor" data-testid="tab-uses-competitor">
                Uses Competitor
              </TabsTrigger>
            </TabsList>

            <TabsContent value="no_software" className="space-y-6">
              <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">No Software Track</h3>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  These sequences are sent to contacts who don't currently use any booking software. Focus on pain points and benefits of adopting software.
                </p>
              </div>
              {renderSequenceTable(noSoftwareSequences, isLoadingNoSoftware, "no_software")}
            </TabsContent>

            <TabsContent value="uses_competitor" className="space-y-6">
              <div className="p-4 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg">
                <h3 className="font-semibold text-orange-900 dark:text-orange-100 mb-1">Uses Competitor Track</h3>
                <p className="text-sm text-orange-800 dark:text-orange-200">
                  These sequences are sent to contacts who are using competitor software (MoeGo, Vagaro, etc.). Focus on switching benefits and competitive advantages.
                </p>
              </div>
              {renderSequenceTable(competitorSequences, isLoadingCompetitor, "uses_competitor")}
            </TabsContent>
          </Tabs>

          <div className="mt-6 p-4 bg-muted border border-border rounded-lg">
            <h3 className="font-semibold text-foreground mb-2">How Email Sequences Work</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• When a deal is marked "Qualified Lead", the system automatically selects the right track based on software status</li>
              <li>• Sequence 1 sends on your chosen date and time (Eastern Time)</li>
              <li>• Sequences 2-5 send automatically after specified days if no reply received</li>
              <li>• Use placeholders: [Contact_First_Name], [Sales_Person], [Business_Name] in your email content</li>
              <li>• Requires Reserved VM deployment for 24/7 automation</li>
            </ul>
          </div>
        </div>
      </main>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedSequence?.id 
                ? `Edit Sequence ${selectedSequence.sequenceNumber}` 
                : `Configure Sequence ${selectedSequence?.sequenceNumber || 1}`}
              {selectedSequence?.sequenceTrack && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({selectedSequence.sequenceTrack === "no_software" ? "No Software" : "Uses Competitor"} Track)
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <EmailSequenceForm
            sequence={selectedSequence}
            onSuccess={handleFormClose}
            onCancel={handleFormClose}
          />
        </DialogContent>
      </Dialog>

      {sequenceForContacts && (
        <AddContactsToSequenceDialog
          sequence={sequenceForContacts}
          open={isAddContactsOpen}
          onOpenChange={setIsAddContactsOpen}
        />
      )}
    </>
  );
}
