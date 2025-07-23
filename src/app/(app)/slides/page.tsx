"use client";

import { useState } from "react";
import { Presentation, Clipboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function SlidesPage() {
  const [generatedContent, setGeneratedContent] = useState<string | null>(`# Sample Meeting Slides
  
## Agenda
- Welcome & Introduction
- Key Updates
- Project A Progress
- Action Items
- Q&A

## Key Updates
- We have successfully onboarded 5 new members this month!
- The budget for Q3 has been approved.

## Action Items
- All members to review the project proposal by Friday.
- Team leads to schedule their next sync-up meeting.
  `);
  const { toast } = useToast();
  
  const handleCopy = () => {
    if (generatedContent) {
      navigator.clipboard.writeText(generatedContent);
      toast({ title: "Copied to clipboard!" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Presentation className="h-4 w-4" />
        <AlertTitle>Heads up!</AlertTitle>
        <AlertDescription>
          To generate new meeting slides, please use the <Link href="/assistant" className="font-semibold underline">AI Assistant</Link>.
        </AlertDescription>
      </Alert>
      <Card className="flex flex-col flex-grow">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Meeting Slides Content</CardTitle>
            <CardDescription>
              Here is the latest generated slide content. You can copy it or edit it below.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={handleCopy} disabled={!generatedContent}>
            <Clipboard className="h-4 w-4"/>
            <span className="sr-only">Copy</span>
          </Button>
        </CardHeader>
        <CardContent className="flex-grow">
          {generatedContent && (
            <div className="prose prose-sm dark:prose-invert max-w-none p-4 bg-muted rounded-md h-full overflow-auto">
              <pre className="whitespace-pre-wrap break-words bg-transparent p-0 m-0">{generatedContent}</pre>
            </div>
          )}
           {!generatedContent && (
            <div className="flex items-center justify-center h-full text-center text-muted-foreground">
                <p>Generated content from the AI Assistant will be displayed here.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
