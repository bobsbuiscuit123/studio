
'use client';

import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Send, Loader2, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/lib/data-hooks';
import { runAssistant, AssistantOutput } from '@/ai/flows/assistant';
import { cn } from '@/lib/utils';

const formSchema = z.object({
  query: z.string().min(1, 'Please enter a message.'),
});

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolOutput?: any;
  toolName?: string;
};

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { query: '' },
  });

  const scrollToBottom = () => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: values.query,
    };

    setMessages((prev) => [...prev, userMessage]);
    form.reset();

    try {
      const result: AssistantOutput = await runAssistant({ query: values.query });
      
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.response,
        toolOutput: result.toolOutput,
        toolName: result.toolName,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (result.toolName) {
        toast({
          title: "Assistant Action",
          description: `Successfully used the ${result.toolName} tool.`,
        });
      }

    } catch (error) {
      console.error('Assistant Error:', error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: "Sorry, I encountered an error while processing your request. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
      toast({
        title: 'Error',
        description: 'Failed to get a response from the assistant.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col">
      <Card className="flex flex-col flex-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot /> ClubHub AI Assistant
          </CardTitle>
          <CardDescription>
            Your AI-powered club management assistant. Ask it to perform tasks for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col p-0">
          <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
            <div className="space-y-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'flex items-start gap-4',
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {message.role === 'assistant' && (
                    <Avatar className="h-9 w-9 border">
                      <AvatarFallback>
                        <Bot />
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={cn(
                      'max-w-xl rounded-lg p-3',
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    )}
                  >
                    <ReactMarkdown className="prose dark:prose-invert prose-sm">
                        {message.content}
                    </ReactMarkdown>
                    {message.toolOutput && (
                        <Card className="mt-4 bg-background/50">
                            <CardHeader className="p-2">
                                <CardTitle className="text-xs">Tool Output: {message.toolName}</CardTitle>
                            </CardHeader>
                            <CardContent className="p-2">
                                <pre className="text-xs overflow-x-auto bg-gray-800 text-white p-2 rounded-md">
                                    <code>{JSON.stringify(message.toolOutput, null, 2)}</code>
                                </pre>
                            </CardContent>
                        </Card>
                    )}
                  </div>
                  {message.role === 'user' && user && (
                    <Avatar className="h-9 w-9 border">
                      <AvatarImage src={user.avatar} alt={user.name} />
                      <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
                    </Avatar>
                  )}
                </div>
              ))}
              {messages.length === 0 && (
                <div className="text-center text-muted-foreground p-8">
                    <p>Start a conversation with your AI Assistant!</p>
                    <p className="text-sm">Try prompts like:</p>
                    <ul className="text-sm list-disc list-inside mt-2">
                        <li>"Draft an announcement for our bake sale next week."</li>
                        <li>"Generate slides for the quarterly review meeting."</li>
                        <li>"Received $50 in member dues today."</li>
                    </ul>
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="border-t p-4">
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="flex items-center gap-2"
            >
              <Input
                {...form.register('query')}
                placeholder="Ask the assistant to do something..."
                autoComplete="off"
                disabled={isLoading}
              />
              <Button type="submit" size="icon" disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
