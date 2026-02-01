import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import Header from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Search, Plus, Download, Upload, Trash2, Eye, AlertCircle, CheckCircle, Clock, XCircle, RefreshCw, Settings } from "lucide-react";
import type { LeadDiscoveryJob, LeadDiscoveryResult } from "@shared/schema";

interface LeadDiscoveryConfig {
  serpApiConfigured: boolean;
  usage: {
    used: number;
    quota: number;
    hardStopAt: number;
    warningLevel: 'none' | 'yellow' | 'red' | 'hardstop';
    isQuotaReached: boolean;
  };
  config: {
    queriesPerZip: number;
    maxZipsPerRun: number;
    maxRunsPerDay: number;
    maxSerpCallsPerHour: number;
    enableThirdQuery: boolean;
    planType: string;
  };
  activeQueries: string[];
}

const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" }
];

export default function LeadDiscovery() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [showNewJobDialog, setShowNewJobDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [selectedJob, setSelectedJob] = useState<LeadDiscoveryJob | null>(null);
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  
  const [newJobState, setNewJobState] = useState("");
  const [newJobZipCodes, setNewJobZipCodes] = useState("");

  const { data: config, refetch: refetchConfig } = useQuery<LeadDiscoveryConfig>({
    queryKey: ["/api/lead-discovery/config"],
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (updates: Partial<LeadDiscoveryConfig['config']>) => {
      const res = await apiRequest("PATCH", "/api/lead-discovery/config", updates);
      return res.json();
    },
    onSuccess: () => {
      refetchConfig();
      toast({ title: "Settings updated" });
    },
    onError: () => {
      toast({ title: "Failed to update settings", variant: "destructive" });
    },
  });

  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = useQuery<LeadDiscoveryJob[]>({
    queryKey: ["/api/lead-discovery/jobs"],
    refetchInterval: selectedJob?.status === "running" ? 3000 : false,
  });

  const { data: results = [], isLoading: resultsLoading } = useQuery<LeadDiscoveryResult[]>({
    queryKey: ["/api/lead-discovery/jobs", selectedJob?.id, "results"],
    enabled: !!selectedJob,
  });

  const createJobMutation = useMutation({
    mutationFn: async (data: { state: string; zipCodes: string }) => {
      const res = await apiRequest("POST", "/api/lead-discovery/jobs", {
        ...data,
        searchEngines: "google_maps",
        maxResultsPerZip: 20,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/jobs"] });
      refetchConfig();
      setShowNewJobDialog(false);
      setNewJobState("");
      setNewJobZipCodes("");
      toast({ title: "Search started", description: "Lead discovery job has been created and is running." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to start search", variant: "destructive" });
    },
  });

  const cancelJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("POST", `/api/lead-discovery/jobs/${jobId}/cancel`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/jobs"] });
      toast({ title: "Job cancelled" });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiRequest("DELETE", `/api/lead-discovery/jobs/${jobId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/jobs"] });
      if (selectedJob) setSelectedJob(null);
      toast({ title: "Job deleted" });
    },
  });

  const importResultsMutation = useMutation({
    mutationFn: async (resultIds: string[]) => {
      const res = await apiRequest("POST", "/api/lead-discovery/import", { resultIds });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-discovery/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setSelectedResults([]);
      toast({ 
        title: "Import complete", 
        description: `Imported ${data.imported} contacts${data.errors.length > 0 ? `. ${data.errors.length} errors.` : ""}` 
      });
    },
    onError: (error: any) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateJob = () => {
    if (!newJobState || !newJobZipCodes.trim()) {
      toast({ title: "Missing info", description: "Please select a state and enter ZIP codes", variant: "destructive" });
      return;
    }
    
    // Validate ZIP count against limit
    const zipCount = newJobZipCodes.split(/[,\n]/).map(z => z.trim()).filter(z => z).length;
    const maxZips = config?.config?.maxZipsPerRun || 3;
    if (zipCount > maxZips) {
      toast({ 
        title: "Too many ZIP codes", 
        description: `Maximum ${maxZips} ZIP codes allowed per search. You entered ${zipCount}.`, 
        variant: "destructive" 
      });
      return;
    }
    
    // Check if quota is reached
    if (config?.usage?.isQuotaReached) {
      toast({ 
        title: "SERP quota reached", 
        description: "Upgrade to Developer plan to continue searching.", 
        variant: "destructive" 
      });
      return;
    }
    
    createJobMutation.mutate({
      state: newJobState,
      zipCodes: newJobZipCodes,
    });
  };

  const handleExport = (jobId: string) => {
    window.open(`/api/lead-discovery/export/${jobId}`, "_blank");
  };

  const toggleResultSelection = (resultId: string) => {
    setSelectedResults(prev => 
      prev.includes(resultId) 
        ? prev.filter(id => id !== resultId)
        : [...prev, resultId]
    );
  };

  const selectAllResults = () => {
    const importableResults = results.filter(r => r.isImported !== "true");
    if (selectedResults.length === importableResults.length) {
      setSelectedResults([]);
    } else {
      setSelectedResults(importableResults.map(r => r.id));
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "running":
        return <Badge variant="default" className="bg-blue-500"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
      case "completed":
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case "cancelled":
        return <Badge variant="outline"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getSoftwareBadge = (usesSoftware: string | null) => {
    switch (usesSoftware) {
      case "Yes":
        return <Badge variant="default" className="bg-green-500">Yes</Badge>;
      case "No":
        return <Badge variant="secondary">No</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="Lead Discovery" />
      
      <main className="flex-1 overflow-y-auto p-6">
        {!config?.serpApiConfigured && (
          <Card className="mb-6 border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                API Key Required
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-yellow-600 dark:text-yellow-300">
                SerpAPI key is not configured. Please add your SERPAPI_API_KEY secret to enable lead discovery searches.
              </p>
            </CardContent>
          </Card>
        )}

        {/* SERP Usage Bar */}
        {config?.usage && (
          <Card className={`mb-6 ${
            config.usage.warningLevel === 'hardstop' ? 'border-red-500 bg-red-50 dark:bg-red-900/20' :
            config.usage.warningLevel === 'red' ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' :
            config.usage.warningLevel === 'yellow' ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20' : ''
          }`}>
            <CardContent className="pt-4">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">SerpAPI Usage:</span>
                  <span className={`font-bold ${
                    config.usage.warningLevel === 'hardstop' ? 'text-red-600' :
                    config.usage.warningLevel === 'red' ? 'text-orange-600' :
                    config.usage.warningLevel === 'yellow' ? 'text-yellow-600' : ''
                  }`}>
                    {config.usage.used} / {config.usage.quota}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {config.config?.planType === 'developer' ? 'Developer Plan' : 'Free Plan'}
                  </Badge>
                </div>
                {isAdmin && (
                  <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" data-testid="btn-settings">
                        <Settings className="h-4 w-4 mr-1" />
                        Settings
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Lead Discovery Settings</DialogTitle>
                        <DialogDescription>Admin controls for SERP usage and queries</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label>Enable 3rd Query</Label>
                            <p className="text-xs text-muted-foreground">
                              "Grooming salon in [STATE], Zip code [ZIP]"
                            </p>
                          </div>
                          <Switch
                            checked={config.config?.enableThirdQuery}
                            onCheckedChange={(checked) => updateConfigMutation.mutate({ enableThirdQuery: checked })}
                            data-testid="switch-third-query"
                          />
                        </div>
                        <div className="border-t pt-4">
                          <Label className="text-sm font-medium">Plan Settings</Label>
                          <p className="text-xs text-muted-foreground mb-2">
                            Current plan: {config.config?.planType}
                          </p>
                          {config.config?.planType === 'free' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateConfigMutation.mutate({ planType: 'developer', maxZipsPerRun: 20, queriesPerZip: 3 })}
                              data-testid="btn-upgrade-plan"
                            >
                              Upgrade to Developer Plan
                            </Button>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            Developer plan: 5000 searches/month, 20 ZIPs/run, 3 queries/ZIP
                          </p>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <Progress 
                value={(config.usage.used / config.usage.quota) * 100} 
                className={`h-2 ${
                  config.usage.warningLevel === 'hardstop' ? '[&>div]:bg-red-500' :
                  config.usage.warningLevel === 'red' ? '[&>div]:bg-orange-500' :
                  config.usage.warningLevel === 'yellow' ? '[&>div]:bg-yellow-500' : ''
                }`}
              />
              {config.usage.isQuotaReached && (
                <p className="text-sm text-red-600 mt-2 font-medium">
                  SERP quota reached – upgrade required to continue searching
                </p>
              )}
              {config.usage.warningLevel === 'red' && !config.usage.isQuotaReached && (
                <p className="text-sm text-orange-600 mt-2">
                  Warning: {config.usage.hardStopAt - config.usage.used} searches remaining before hard stop
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="jobs" className="space-y-4">
          <div className="flex justify-between items-center">
            <TabsList>
              <TabsTrigger value="jobs" data-testid="tab-jobs">Search Jobs</TabsTrigger>
              <TabsTrigger value="results" data-testid="tab-results" disabled={!selectedJob}>
                Results {selectedJob && `(${results.length})`}
              </TabsTrigger>
            </TabsList>

            <Dialog open={showNewJobDialog} onOpenChange={setShowNewJobDialog}>
              <DialogTrigger asChild>
                <Button disabled={!config?.serpApiConfigured} data-testid="btn-new-search">
                  <Plus className="h-4 w-4 mr-2" />
                  New Search
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Start Lead Discovery Search</DialogTitle>
                  <DialogDescription>
                    Search for pet grooming businesses in specific ZIP codes
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>State</Label>
                    <Select value={newJobState} onValueChange={setNewJobState}>
                      <SelectTrigger data-testid="select-state">
                        <SelectValue placeholder="Select state" />
                      </SelectTrigger>
                      <SelectContent>
                        {US_STATES.map(state => (
                          <SelectItem key={state.code} value={state.code}>{state.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label>ZIP Codes (comma-separated or one per line)</Label>
                    <Textarea
                      value={newJobZipCodes}
                      onChange={(e) => setNewJobZipCodes(e.target.value)}
                      placeholder="10001, 10002, 10003&#10;or paste from CSV"
                      rows={4}
                      data-testid="input-zipcodes"
                    />
                  </div>

                  {config?.config && (
                    <div className="text-sm p-3 bg-muted rounded-md space-y-1">
                      <p><strong>Limits:</strong></p>
                      <p>• Max {config.config.maxZipsPerRun} ZIP codes per search</p>
                      <p>• {config.config.queriesPerZip} queries per ZIP ({config.config.enableThirdQuery ? "3rd query enabled" : "2 default"})</p>
                      <p>• Uses Google Maps search engine</p>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowNewJobDialog(false)}>Cancel</Button>
                    <Button 
                      onClick={handleCreateJob} 
                      disabled={createJobMutation.isPending || !newJobState || !newJobZipCodes.trim()}
                      data-testid="btn-start-search"
                    >
                      {createJobMutation.isPending ? "Starting..." : "Start Search"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <TabsContent value="jobs" className="space-y-4">
            {jobsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading jobs...</div>
            ) : jobs.length === 0 ? (
              <Card>
                <CardContent className="text-center py-12">
                  <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No search jobs yet</h3>
                  <p className="text-muted-foreground mb-4">Start a new search to find pet grooming businesses</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {jobs.map(job => (
                  <Card key={job.id} className={selectedJob?.id === job.id ? "ring-2 ring-primary" : ""}>
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-lg">
                            {job.state} - {job.totalZipCodes} ZIP codes
                          </CardTitle>
                          <CardDescription>
                            Created {new Date(job.createdAt!).toLocaleString()}
                          </CardDescription>
                        </div>
                        {getStatusBadge(job.status)}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {job.status === "running" && (
                        <div className="mb-4">
                          <div className="flex justify-between text-sm mb-1">
                            <span>Processing ZIP codes</span>
                            <span>{job.processedZipCodes} / {job.totalZipCodes}</span>
                          </div>
                          <Progress value={(job.processedZipCodes! / job.totalZipCodes!) * 100} />
                        </div>
                      )}
                      
                      <div className="flex gap-4 text-sm text-muted-foreground mb-4">
                        <span>Found: {job.totalBusinessesFound || 0}</span>
                        <span>Duplicates removed: {job.duplicatesRemoved || 0}</span>
                        <span>Engines: {job.searchEngines}</span>
                      </div>

                      {job.errorMessage && (
                        <p className="text-sm text-red-500 mb-4">{job.errorMessage}</p>
                      )}

                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => setSelectedJob(job)}
                          data-testid={`btn-view-results-${job.id}`}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View Results
                        </Button>
                        {job.status === "completed" && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleExport(job.id)}
                            data-testid={`btn-export-${job.id}`}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Export CSV
                          </Button>
                        )}
                        {job.status === "running" && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => cancelJobMutation.mutate(job.id)}
                            data-testid={`btn-cancel-${job.id}`}
                          >
                            Cancel
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => deleteJobMutation.mutate(job.id)}
                          className="text-red-500 hover:text-red-700"
                          data-testid={`btn-delete-${job.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="results" className="space-y-4">
            {selectedJob && (
              <>
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-medium">Results for {selectedJob.state}</h3>
                    <p className="text-sm text-muted-foreground">
                      {results.filter(r => r.isImported !== "true").length} available to import
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={selectAllResults}
                      disabled={results.length === 0}
                      data-testid="btn-select-all"
                    >
                      {selectedResults.length === results.filter(r => r.isImported !== "true").length 
                        ? "Deselect All" 
                        : "Select All"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => importResultsMutation.mutate(selectedResults)}
                      disabled={selectedResults.length === 0 || importResultsMutation.isPending}
                      data-testid="btn-import-selected"
                    >
                      <Upload className="h-4 w-4 mr-1" />
                      Import Selected ({selectedResults.length})
                    </Button>
                  </div>
                </div>

                {resultsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading results...</div>
                ) : results.length === 0 ? (
                  <Card>
                    <CardContent className="text-center py-8 text-muted-foreground">
                      No results found for this search job
                    </CardContent>
                  </Card>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>Business</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead>Website</TableHead>
                          <TableHead>Uses Software</TableHead>
                          <TableHead>Software</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.map(result => (
                          <TableRow key={result.id} className={result.isImported === "true" ? "opacity-50" : ""}>
                            <TableCell>
                              <Checkbox
                                checked={selectedResults.includes(result.id)}
                                onCheckedChange={() => toggleResultSelection(result.id)}
                                disabled={result.isImported === "true"}
                                data-testid={`checkbox-result-${result.id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{result.company}</div>
                              <div className="text-sm text-muted-foreground">{result.zipCode}</div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{result.phone || "-"}</div>
                              <div className="text-sm text-muted-foreground">{result.email || "-"}</div>
                            </TableCell>
                            <TableCell>
                              {result.websiteUrl ? (
                                <a 
                                  href={result.websiteUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:underline text-sm truncate max-w-[200px] block"
                                  data-testid={`link-website-${result.id}`}
                                >
                                  {new URL(result.websiteUrl).hostname}
                                </a>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>{getSoftwareBadge(result.usesSoftware)}</TableCell>
                            <TableCell>
                              <div className="text-sm">{result.currentSoftware || "-"}</div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{result.leadSource}</div>
                            </TableCell>
                            <TableCell>
                              {result.isImported === "true" ? (
                                <Badge variant="outline" className="text-green-600">Imported</Badge>
                              ) : (
                                <Badge variant="secondary">Ready</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
