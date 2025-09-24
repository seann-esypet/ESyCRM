import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Calendar, CheckSquare } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import type { Task } from "@shared/schema";

interface TaskListProps {
  tasks: Task[];
  isLoading: boolean;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
}

export default function TaskList({ tasks, isLoading, onEdit, onDelete }: TaskListProps) {
  const toggleTaskMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      return apiRequest("PUT", `/api/tasks/${id}`, {
        status: completed ? "completed" : "pending"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });

  const formatDate = (date: string | Date | null) => {
    if (!date) return "No due date";
    const d = new Date(date);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (d.toDateString() === today.toDateString()) {
      return "Today";
    } else if (d.toDateString() === tomorrow.toDateString()) {
      return "Tomorrow";
    } else {
      return d.toLocaleDateString();
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "bg-destructive text-destructive-foreground";
      case "medium":
        return "bg-yellow-500 text-white";
      case "low":
        return "bg-accent text-accent-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "pending":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const handleToggleTask = (task: Task) => {
    toggleTaskMutation.mutate({
      id: task.id,
      completed: task.status !== "completed"
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="flex items-center space-x-4">
                <div className="w-4 h-4 bg-muted rounded"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4"></div>
                  <div className="h-3 bg-muted rounded w-1/2"></div>
                </div>
                <div className="w-16 h-6 bg-muted rounded"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!tasks.length) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <CheckSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground mb-2">No tasks found</h3>
          <p className="text-muted-foreground">
            Stay organized by creating your first task.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group tasks by status
  const pendingTasks = tasks.filter(task => task.status === "pending");
  const completedTasks = tasks.filter(task => task.status === "completed");

  return (
    <div className="space-y-8" data-testid="tasks-list">
      {/* Pending Tasks */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Pending Tasks ({pendingTasks.length})
        </h3>
        <div className="space-y-4">
          {pendingTasks.map((task) => (
            <Card 
              key={task.id} 
              className="hover:shadow-md transition-shadow"
              data-testid={`task-card-${task.id}`}
            >
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <Checkbox
                    checked={task.status === "completed"}
                    onCheckedChange={() => handleToggleTask(task)}
                    className="w-5 h-5"
                    data-testid={`task-checkbox-${task.id}`}
                  />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3 mb-2">
                      <h4 className="font-medium text-foreground">
                        {task.title}
                      </h4>
                      <Badge className={getPriorityColor(task.priority)}>
                        {task.priority.toUpperCase()}
                      </Badge>
                      <Badge className={getStatusColor(task.status)}>
                        {task.status.toUpperCase()}
                      </Badge>
                    </div>
                    
                    {task.description && (
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                        {task.description}
                      </p>
                    )}
                    
                    <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-4 w-4" />
                        <span>Due: {formatDate(task.dueDate)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(task)}
                      data-testid={`edit-task-${task.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(task.id)}
                      className="text-destructive hover:text-destructive"
                      data-testid={`delete-task-${task.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-4">
            Completed Tasks ({completedTasks.length})
          </h3>
          <div className="space-y-4">
            {completedTasks.map((task) => (
              <Card 
                key={task.id} 
                className="opacity-75 hover:opacity-100 transition-opacity"
                data-testid={`task-card-${task.id}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-center space-x-4">
                    <Checkbox
                      checked={true}
                      onCheckedChange={() => handleToggleTask(task)}
                      className="w-5 h-5"
                      data-testid={`task-checkbox-${task.id}`}
                    />
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <h4 className="font-medium text-foreground line-through">
                          {task.title}
                        </h4>
                        <Badge className={getPriorityColor(task.priority)}>
                          {task.priority.toUpperCase()}
                        </Badge>
                        <Badge className={getStatusColor(task.status)}>
                          {task.status.toUpperCase()}
                        </Badge>
                      </div>
                      
                      {task.description && (
                        <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                          {task.description}
                        </p>
                      )}
                      
                      <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                        <div className="flex items-center space-x-1">
                          <Calendar className="h-4 w-4" />
                          <span>Completed: {formatDate(task.completedAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(task)}
                        data-testid={`edit-task-${task.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(task.id)}
                        className="text-destructive hover:text-destructive"
                        data-testid={`delete-task-${task.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
