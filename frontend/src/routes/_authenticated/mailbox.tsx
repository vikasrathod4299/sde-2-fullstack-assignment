import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, Mail, Clock, Calendar, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { toast } from 'sonner';


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

const fetchMailboxQuota = async (id: number, token: string | null): Promise<MailboxQuota> => {
  const apiUrl = import.meta.env.VITE_API_URL;
  const response = await fetch(`${apiUrl}/mailboxes/${id}/quota`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new Error(`Failed to fetch quota for mailbox ${id}`);
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
  const percentage = Math.min((used / limit) * 100, 100);
  const isWarning = percentage >= 80;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </div>
        <span className={cn("font-medium", isWarning ? "text-red-600" : "text-foreground")}>
          {used} / {limit}
        </span>
      </div>
      <Progress 
        value={percentage} 
        className={cn("h-2", isWarning ? "[&>div]:bg-red-600" : "[&>div]:bg-primary")} 
      />
      {isWarning && (
        <div className="flex items-center gap-1 text-[10px] text-red-600 font-medium">
          <AlertCircle className="h-3 w-3" />
          <span>Usage limit reached 80%</span>
        </div>
      )}
    </div>
  );
}

function MailboxCard({ mailbox }: { mailbox: Mailbox }) {
  const token = useAuth((state) => state.token);
  
  const { data: quota, isLoading, isError } = useQuery({
    queryKey: ['mailbox-quota', mailbox.id],
    queryFn: () => fetchMailboxQuota(mailbox.id, token),
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  return (
    <Card className="overflow-hidden border-slate-200 hover:shadow-md transition-shadow">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">{mailbox.email}</CardTitle>
              <CardDescription className="text-xs">ID: {mailbox.id}</CardDescription>
            </div>
          </div>
          <Badge variant="secondary" className="bg-green-50 text-green-700 hover:bg-green-100 border-none font-medium">
            Active
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-0">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <div className="p-3 bg-red-50 text-red-600 text-xs rounded-md border border-red-100 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Failed to load quota data
          </div>
        ) : (
          <>
            <QuotaProgress 
              label="Daily Quota" 
              used={quota?.daily.used || 0} 
              limit={quota?.daily.limit || mailbox.daily_limit} 
              icon={Calendar}
            />
            <QuotaProgress 
              label="Hourly Quota" 
              used={quota?.hourly.used || 0} 
              limit={quota?.hourly.limit || mailbox.hourly_limit} 
              icon={Clock}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}


export const Route = createFileRoute('/_authenticated/mailbox')({
  component: MailboxComponent,
});

function MailboxComponent() {
  const token = useAuth((state) => state.token);

  const { data: mailboxes, isLoading, isError, error } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => fetchMailboxes(token),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight">Mailbox Management</h2>
          <p className="text-muted-foreground">
            Monitor your sending limits and email health in real-time.
          </p>
        </div>
        <AddMailboxDialog />
      </div>
      
      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="h-[250px] animate-pulse bg-slate-50 border-dashed" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex h-[400px] flex-col items-center justify-center text-center p-8 bg-red-50 rounded-xl border border-red-100">
          <AlertCircle className="h-12 w-12 text-red-600 mb-4" />
          <h3 className="text-lg font-bold text-red-900">Failed to load mailboxes</h3>
          <p className="text-red-700 mt-2">{(error as Error).message}</p>
        </div>
      ) : !mailboxes || mailboxes.length === 0 ? (
        <div className="flex h-[400px] shrink-0 items-center justify-center rounded-md border border-dashed">
          <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
            <Mail className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No mailboxes</h3>
            <p className="mb-4 mt-2 text-sm text-muted-foreground">
              You haven't added any mailboxes yet. Click the "Add Mailbox" button to get started.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {mailboxes.map((mailbox) => (
            <MailboxCard key={mailbox.id} mailbox={mailbox} />
          ))}
        </div>
      )}
    </div>
  );
}
