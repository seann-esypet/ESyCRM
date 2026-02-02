import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Trash2, Mail, Phone, Users } from "lucide-react";
import type { Contact } from "@shared/schema";

interface ContactListProps {
  contacts: Contact[];
  isLoading: boolean;
  onEdit: (contact: Contact) => void;
  onDelete: (id: string) => void;
  onStatusChange: (contactId: string, newStatus: string) => void;
}

export default function ContactList({ contacts, isLoading, onEdit, onDelete, onStatusChange }: ContactListProps) {
  const formatDate = (date: string | Date | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleDateString();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse flex items-center space-x-4">
                <div className="w-10 h-10 bg-muted rounded-full"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-1/4"></div>
                  <div className="h-3 bg-muted rounded w-1/3"></div>
                </div>
                <div className="h-8 w-20 bg-muted rounded"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!contacts.length) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground mb-2">No contacts found</h3>
          <p className="text-muted-foreground">
            Get started by adding your first contact.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="contacts-table">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Last Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow 
                key={contact.id} 
                className="hover:bg-muted/50"
                data-testid={`contact-row-${contact.id}`}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">
                      {contact.firstName.charAt(0)}{contact.lastName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium">{contact.firstName} {contact.lastName}</p>
                      {contact.jobTitle && (
                        <p className="text-sm text-muted-foreground">{contact.jobTitle}</p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>{contact.company || "-"}</TableCell>
                <TableCell>
                  <div className="max-w-[150px] truncate" title={contact.address || ""}>
                    {contact.address || "-"}
                  </div>
                </TableCell>
                <TableCell>
                  {contact.email ? (
                    <div className="flex items-center space-x-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{contact.email}</span>
                    </div>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell>
                  {contact.phone ? (
                    <div className="flex items-center space-x-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{contact.phone}</span>
                    </div>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell>{formatDate(contact.lastContactDate)}</TableCell>
                <TableCell>
                  <Select 
                    value={contact.status} 
                    onValueChange={(value) => onStatusChange(contact.id, value)}
                  >
                    <SelectTrigger 
                      className="w-[110px]" 
                      data-testid={`status-select-${contact.id}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="pipeline">Pipeline</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(contact)}
                      data-testid={`edit-contact-${contact.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(contact.id)}
                      className="text-destructive hover:text-destructive"
                      data-testid={`delete-contact-${contact.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
