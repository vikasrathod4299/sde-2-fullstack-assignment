import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_authenticated/sequence')({
  component: SequenceComponent,
});

function SequenceComponent() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Sequences</h2>
          <p className="text-muted-foreground">
            Manage your automated email sequences.
          </p>
        </div>
        <Button>Create Sequence</Button>
      </div>
      <div className="flex-1 rounded-xl border bg-card text-card-foreground shadow p-6">
        <div className="flex h-[400px] shrink-0 items-center justify-center rounded-md border border-dashed">
          <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
            <h3 className="mt-4 text-lg font-semibold">No sequences</h3>
            <p className="mb-4 mt-2 text-sm text-muted-foreground">
              You haven't created any sequences yet. Click the button above to get started.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
