import { MessageChatScreen } from "@/components/messages/mobile-messages";

export const dynamic = 'force-dynamic';

export default async function MessageConversationPage({
  params,
}: Readonly<{
  params: Promise<{ conversationId: string }>;
}>) {
  const { conversationId } = await params;
  return <MessageChatScreen conversationId={conversationId} />;
}
