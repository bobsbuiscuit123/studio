
'use client';

'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Send, Loader2, Bot, CheckCircle2, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { planTasksAction, runTaskAction } from './actions';

type TaskType = 'announcement' | 'slides' | 'calendar' | 'email' | 'transaction' | 'social' | 'other';

type PlannedTask = {
  id: string;
  type: TaskType;
  prompt: string;
  followUpQuestion?: string;
  status: 'pending' | 'sent' | 'error';
  result?: any;
  error?: string;
};

const formSchema = z.object({
  query: z.string().min(5, 'Please provide a bit more detail.'),
});

export default function AssistantPage() {
  const [tasks, setTasks] = useState<PlannedTask[]>([]);
  const [summary, setSummary] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { query: '' },
  });

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsPlanning(true);
    setTasks([]);
    setSummary('');
    try {
      const plan = await planTasksAction(values.query);
      const planned = plan.tasks.map(task => ({
        ...task,
        status: 'pending' as const,
      }));
      setTasks(planned);
      setSummary(plan.summary);
    } catch (error: any) {
      console.error('Assistant planner error:', error);
      toast({
        title: 'Assistant error',
        description: error?.message ?? 'Failed to plan tasks.',
        variant: 'destructive',
      });
    } finally {
      setIsPlanning(false);
      form.reset();
    }
  };

  const updateTaskPrompt = (id: string, prompt: string) => {
    setTasks(prev =>
      prev.map(t => (t.id === id ? { ...t, prompt } : t))
    );
  };

  const markTask = (id: string, data: Partial<PlannedTask>) => {
    setTasks(prev =>
      prev.map(t => (t.id === id ? { ...t, ...data } : t))
    );
  };

  const runTask = async (task: PlannedTask) => {
    setSendingId(task.id);
    try {
      const result = await runTaskAction(task.type, task.prompt);
      markTask(task.id, { status: 'sent', result, error: undefined });
      toast({
        title: 'Task sent',
        description: `Completed ${task.type} task.`,
      });
    } catch (error: any) {
      console.error(`Assistant task ${task.id} error:`, error);
      markTask(task.id, { status: 'error', error: error?.message ?? 'Failed to run task.' });
      toast({
        title: 'Task failed',
        description: error?.message ?? 'Could not run this task.',
        variant: 'destructive',
      });
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot /> ClubHub AI Assistant
          </CardTitle>
          <CardDescription>
            Ask for anything (announcements, slides, calendar, email, finances, social). The assistant will plan tasks, ask follow-ups, and let you review before sending.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col gap-3">
            <Input
              {...form.register('query')}
              placeholder="e.g., Make slides on safety training, post an announcement with the slides, and email members to review."
              autoComplete="off"
              disabled={isPlanning}
            />
            <Button type="submit" disabled={isPlanning}>
              {isPlanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {isPlanning ? 'Planning...' : 'Ask Assistant'}
            </Button>
          </form>
          {summary && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <strong>Plan:</strong> {summary}
            </div>
          )}
        </CardContent>
      </Card>

      {tasks.length > 0 && (
        <Card className="flex-1 overflow-auto">
          <CardHeader>
            <CardTitle>Planned Tasks</CardTitle>
            <CardDescription>Review, edit, answer follow-ups, then send each task.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {tasks.map(task => (
              <div key={task.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold capitalize">{task.type} task</div>
                  {task.status === 'sent' && (
                    <span className="inline-flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle2 className="h-4 w-4" /> Sent
                    </span>
                  )}
                  {task.status === 'error' && (
                    <span className="inline-flex items-center gap-1 text-red-600 text-sm">
                      <AlertCircle className="h-4 w-4" /> Failed
                    </span>
                  )}
                </div>
                {task.followUpQuestion && (
                  <div className="text-sm text-muted-foreground">
                    Follow-up: {task.followUpQuestion}
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Details / prompt</label>
                  <Textarea
                    value={task.prompt}
                    onChange={(e) => updateTaskPrompt(task.id, e.target.value)}
                    className="min-h-[120px]"
                  />
                </div>
                {task.error && (
                  <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                    {task.error}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => updateTaskPrompt(task.id, task.prompt)}
                    disabled
                    className="hidden"
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={() => runTask(task)}
                    disabled={task.status === 'sent' || sendingId === task.id}
                  >
                    {sendingId === task.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Task'}
                  </Button>
                </div>
                {task.result && (
                  <div className="bg-muted/50 p-2 rounded text-xs">
                    <strong>Result:</strong> {JSON.stringify(task.result, null, 2)}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
