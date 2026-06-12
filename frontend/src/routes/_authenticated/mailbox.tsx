import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, Mail, Clock, Calendar, Plus, Activity, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

// --- Types ---

interface Mailbox {
  id: number;
  email: string;
  daily_limit: number;
  hourly_limit: number;
  created_at: string;
}

interface QuotaInfo {
  used: number;
  limit: number;
}

interface MailboxQuota {
  mailboxId: number;
  email: string;
  daily: QuotaInfo;
  hourly: QuotaInfo;
}

// --- API Helpers ---

const fetchMailboxes = async (token: string | null): Promise<Mailbox[]> => {
  const apiUrl = import.meta.env.VITE_API_URL;
  const response = await fetch(`${apiUrl}/mailboxes`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new Error('Failed to fetch mailboxes');
  return response.json();
};

const createMailbox = async (data: { email: string; daily_limit: number; hourly_limit: number }, token: string | null): Promise<Mailbox> => {
  const apiUrl = import.meta.env.VITE_API_URL;
  const response = await fetch(`${apiUrl}/mailboxes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to create mailbox');
  }
  return response.json();
};

// --- Components ---

function AddMailboxDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [dailyLimit, setDailyLimit] = useState(100);
  const [hourlyLimit, setHourlyLimit] = useState(10);

  const token = useAuth((state) => state.token);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createMailbox({ email, daily_limit: dailyLimit, hourly_limit: hourlyLimit }, token),
    onSuccess: () => {
      toast.success('Mailbox added successfully');
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      setOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setEmail('');
    setDailyLimit(100);
    setHourlyLimit(10);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Add Mailbox
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add New Mailbox</DialogTitle>
            <DialogDescription>
              Connect a new email account and set its sending limits.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="alice@test.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="daily_limit">Daily Limit</Label>
                <Input
                  id="daily_limit"
                  type="number"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(parseInt(e.target.value))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hourly_limit">Hourly Limit</Label>
                <Input
                  id="hourly_limit"
                  type="number"
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(parseInt(e.target.value))}
                  required
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Adding...' : 'Save Mailbox'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QuotaProgress({ label, used, limit, icon: Icon }: { label: string; used: number; limit: number; icon: any }) {
  const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const isCritical = percentage >= 95;
  const isWarning = percentage >= 80 && percentage < 95;

  let progressColorClass = "[&>div]:bg-primary";
  let textColorClass = "text-foreground";
  if (isCritical) {
    progressColorClass = "[&>div]:bg-red-600";
    textColorClass = "text-red-600";
  } else if (isWarning) {
    progressColorClass = "[&>div]:bg-amber-500";
    textColorClass = "text-amber-600";
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{percentage.toFixed(0)}%</span>
          <span className={cn("font-medium", textColorClass)}>
            {used} / {limit}
          </span>
        </div>
      </div>
      <Progress
        value={percentage}
        className={cn("h-1.5", progressColorClass)}
      />
    </div>
  );
}

function MailboxCard({ mailbox, quota, isLoading, isError }: { mailbox: Mailbox, quota?: MailboxQuota, isLoading?: boolean, isError?: boolean }) {
  const dailyPercentage = quota && quota.daily.limit > 0 ? Math.min((quota.daily.used / quota.daily.limit) * 100, 100) : 0;
  const hourlyPercentage = quota && quota.hourly.limit > 0 ? Math.min((quota.hourly.used / quota.hourly.limit) * 100, 100) : 0;

  const maxPercentage = Math.max(dailyPercentage, hourlyPercentage);
  const isCritical = maxPercentage >= 95;
  const isWarning = maxPercentage >= 80 && maxPercentage < 95;

  let BadgeComponent = <Badge variant="secondary" className="bg-green-50 text-green-700 hover:bg-green-100 border-green-200 font-medium shadow-none">Healthy</Badge>;
  if (isCritical) {
    BadgeComponent = <Badge variant="destructive" className="font-medium shadow-none">Critical</Badge>;
  } else if (isWarning) {
    BadgeComponent = <Badge variant="secondary" className="bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200 font-medium shadow-none">Near Limit</Badge>;
  }

  return (
    <Card className="overflow-hidden border-slate-200 hover:shadow-md transition-shadow">
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2 min-w-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <CardTitle className="text-lg font-bold truncate block">{mailbox.email}</CardTitle>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{mailbox.email}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex items-center">
              {isLoading ? <Skeleton className="w-16 h-5" /> : BadgeComponent}
            </div>
          </div>
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Mail className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5 pt-0">
        {isLoading ? (
          <div className="space-y-4 mt-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : isError ? (
          <div className="p-3 bg-red-50 text-red-600 text-xs rounded-md border border-red-100 flex items-center gap-2 mt-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Failed to load quota
          </div>
        ) : (
          <div className="mt-2 space-y-4">
            <QuotaProgress
              label="Daily Sent"
              used={quota?.daily.used || 0}
              limit={quota?.daily.limit || mailbox.daily_limit}
              icon={Calendar}
            />
            <QuotaProgress
              label="Hourly Sent"
              used={quota?.hourly.used || 0}
              limit={quota?.hourly.limit || mailbox.hourly_limit}
              icon={Clock}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main Route Component ---

export const Route = createFileRoute('/_authenticated/mailbox')({
  component: MailboxComponent,
});

function MailboxComponent() {
  const token = useAuth((state) => state.token);

  const { data: mailboxes, isLoading: isLoadingMailboxes, isError: isErrorMailboxes, error } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => fetchMailboxes(token),
  });

  const [quotas, setQuotas] = useState<Record<number, MailboxQuota>>({});
  const [sseConnected, setSseConnected] = useState(false);
  const [sseError, setSseError] = useState(false);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL;
    const es = new EventSource(`${apiUrl}/mailboxes/quota/stream?token=${token}`);

    es.onopen = () => {
      setSseConnected(true);
      setSseError(false);
    };

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const quotasArray: MailboxQuota[] = data.quotas || data;
      const quotaMap: Record<number, MailboxQuota> = {};
      quotasArray.forEach((q: MailboxQuota) => {
        quotaMap[q.mailboxId] = q;
      });
      setQuotas(quotaMap);
    };

    es.onerror = () => {
      setSseError(true);
    };

    return () => es.close();
  }, [token]);

  let nearLimitCount = 0;
  let criticalCount = 0;

  Object.values(quotas).forEach(quota => {
    const dailyPercentage = quota.daily.limit > 0 ? (quota.daily.used / quota.daily.limit) * 100 : 0;
    const hourlyPercentage = quota.hourly.limit > 0 ? (quota.hourly.used / quota.hourly.limit) * 100 : 0;
    const max = Math.max(dailyPercentage, hourlyPercentage);
    if (max >= 95) criticalCount++;
    else if (max >= 80) nearLimitCount++;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight"><span className='text-blue-500 italic'>Mailbox</span > Management</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Monitor your sending limits and email health in <span className='italic text-blue-500'>real-time.</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AddMailboxDialog />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Mailboxes</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mailboxes?.length || 0}</div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Near Limit</CardTitle>
            <AlertTriangle className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{nearLimitCount}</div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Critical Usage</CardTitle>
            <Activity className="h-4 w-4 " />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{criticalCount}</div>
          </CardContent>
        </Card>
      </div>

      {isLoadingMailboxes ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="h-[200px] animate-pulse bg-slate-50 border-dashed" />
          ))}
        </div>
      ) : isErrorMailboxes ? (
        <div className="flex h-[400px] flex-col items-center justify-center text-center p-8 bg-red-50 rounded-xl border border-red-100">
          <AlertCircle className="h-12 w-12 text-red-600 mb-4" />
          <h3 className="text-lg font-bold text-red-900">Failed to load mailboxes</h3>
          <p className="text-red-700 mt-2">{(error as Error).message}</p>
        </div>
      ) : !mailboxes || mailboxes.length === 0 ? (
        <div className="flex h-[400px] shrink-0 items-center justify-center rounded-md border border-dashed bg-slate-50/50">
          <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
            <div className="h-14 w-14 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4">
              <Mail className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold">No mailboxes added</h3>
            <p className="mb-4 mt-2 text-sm text-muted-foreground">
              You haven't added any mailboxes to your account yet. Connect a mailbox to start monitoring your outreach.
            </p>
            <AddMailboxDialog />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {mailboxes.map((mailbox) => {
            const quota = quotas[mailbox.id];
            const isLoading = !sseConnected || (!quota && !sseError);
            const isError = sseError && !quota;
            return (
              <MailboxCard key={mailbox.id} mailbox={mailbox} quota={quota} isLoading={isLoading} isError={isError} />
            );
          })}
        </div>
      )}
    </div>
  );
}
