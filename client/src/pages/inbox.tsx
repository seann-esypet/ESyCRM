import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Mail, MailOpen, Trash2, User } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import type { InboxMessage, Contact } from "@shared/schema";

export default function Inbox() {
  const { user } = useAuth();
  const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(null);

  const { data: messages = [], isLoading } = useQuery<InboxMessage[]>({
    queryKey: ["/api/inbox"],
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (messageId: string) => {
      return apiRequest("PATCH", `/api/inbox/${messageId}`, { isRead: "true" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (messageId: string) => {
      return apiRequest("DELETE", `/api/inbox/${messageId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      setSelectedMessage(null);
    },
  });

  const handleMessageClick = (message: InboxMessage) => {
    setSelectedMessage(message);
    if (message.isRead === "false") {
      markAsReadMutation.mutate(message.id);
    }
  };

  const handleDelete = () => {
    if (selectedMessage && confirm("Are you sure you want to delete this message?")) {
      deleteMutation.mutate(selectedMessage.id);
    }
  };

  const getContactName = (contactId: string | null) => {
    if (!contactId) return "Unknown";
    const contact = contacts.find(c => c.id === contactId);
    return contact ? `${contact.firstName} ${contact.lastName}` : "Unknown";
  };

  const unreadCount = messages.filter(m => m.isRead === "false").length;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground">Loading inbox...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      {/* Message List */}
      <div className="w-96 border-r bg-background">
        <div className="p-4 border-b">
          <h2 className="text-2xl font-bold" data-testid="text-inbox-title">Inbox</h2>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="mt-2" data-testid="badge-unread-count">
              {unreadCount} unread
            </Badge>
          )}
        </div>
        <ScrollArea className="h-[calc(100vh-80px)]">
          {messages.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground" data-testid="text-no-messages">
              No messages yet
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                data-testid={`message-item-${message.id}`}
                className={`p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors ${
                  selectedMessage?.id === message.id ? "bg-muted" : ""
                } ${message.isRead === "false" ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}
                onClick={() => handleMessageClick(message)}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    {message.isRead === "false" ? (
                      <Mail className="h-5 w-5 text-blue-600" />
                    ) : (
                      <MailOpen className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`font-medium truncate ${message.isRead === "false" ? "text-blue-600" : ""}`}>
                        {getContactName(message.contactId)}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {message.receivedAt && format(new Date(message.receivedAt), "MMM d")}
                      </span>
                    </div>
                    <p className={`text-sm truncate ${message.isRead === "false" ? "font-medium" : "text-muted-foreground"}`}>
                      {message.subject}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {message.bodyText?.substring(0, 50)}...
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Message Content */}
      <div className="flex-1 flex flex-col">
        {selectedMessage ? (
          <>
            <div className="p-6 border-b bg-background">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold mb-2" data-testid="text-message-subject">
                    {selectedMessage.subject}
                  </h3>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      <span data-testid="text-message-from">
                        {getContactName(selectedMessage.contactId)}
                      </span>
                    </div>
                    <span data-testid="text-message-date">
                      {selectedMessage.receivedAt && format(new Date(selectedMessage.receivedAt), "MMMM d, yyyy 'at' h:mm a")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    From: {selectedMessage.from}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDelete}
                  data-testid="button-delete-message"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1 p-6">
              <div className="prose max-w-none dark:prose-invert" data-testid="text-message-body">
                {selectedMessage.bodyHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: selectedMessage.bodyHtml }} />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans">
                    {selectedMessage.bodyText}
                  </pre>
                )}
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground" data-testid="text-no-message-selected">
            <div className="text-center">
              <Mail className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p>Select a message to read</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
