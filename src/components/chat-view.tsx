
'use client';
import type { Conversation as ConversationType, User, Message as MessageType } from '@/lib/types';
import { MoreVertical, Phone, Video, Bot, X, Reply, ArrowLeft, Trash2, ArrowDown } from 'lucide-react';
import { Button } from './ui/button';
import { UserAvatar } from './user-avatar';
import { MessageInput } from './message-input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from './ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import React, { useState, useMemo, memo, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { cn } from '@/lib/utils';
import { UserProfileSheet } from './user-profile-sheet';
import { SidebarTrigger } from './ui/sidebar';
import { useAppearance } from './providers/appearance-provider';
import Image from 'next/image';
import { ImagePreviewDialog } from './image-preview-dialog';
import { useToast } from '@/hooks/use-toast';
import { GroupProfileSheet } from './group-profile-sheet';
import { useMobileDesign } from './providers/mobile-provider';
import { MessageList } from './message-list';
import { RightPaneBackground } from './right-pane-background';
import { Timestamp } from 'firebase/firestore';
import { useAppShell } from './app-shell';

const AI_USER_ID = 'gemini-ai-chat-bot-7a4b9c1d-f2e3-4d56-a1b2-c3d4e5f6a7b8';

interface ChatViewProps {
  chat: ConversationType | undefined;
  isAiReplying: boolean;
  currentUser: User | undefined;
  onBack?: () => void;
  messages: MessageType[];
  loadMoreMessages: () => Promise<void>;
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
}

const ChatViewComponent = ({ 
    chat, 
    isAiReplying, 
    currentUser, 
    onBack,
    messages,
    loadMoreMessages,
    hasMoreMessages,
    isLoadingMore
}: ChatViewProps) => {
  const { toast } = useToast();
  const [isProfileSheetOpen, setIsProfileSheetOpen] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState<MessageType | null>(null);
  const { chatBackground } = useAppearance();
  const { isMobileView } = useMobileDesign();
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const prevMessagesLength = useRef(messages.length);

  const {
    usersCache,
    uploadProgress,
    cancelUpload,
    activeSendMessage,
    activeSendFile,
    handleMessageAction,
    handleTyping,
    handleFriendAction,
    handleBlockUser,
    handleMuteToggle,
    handleClearChat,
  } = useAppShell();
  
  const otherParticipant = useMemo(() => {
    if (!chat || !currentUser || chat.type !== 'private') return undefined;
    const otherId = chat.participants.find(p => p !== currentUser.uid);
    return usersCache.get(otherId || '');
  }, [chat, currentUser, usersCache]);

  const typingUsers = useMemo(() => {
    if (!chat?.typing || !currentUser) return [];
    return chat.typing
      .filter(uid => uid !== currentUser.uid)
      .map(uid => usersCache.get(uid)?.name)
      .filter(Boolean) as string[];
  }, [chat?.typing, currentUser, usersCache]);

  const onReply = useCallback((message: MessageType) => {
    setReplyToMessage(message);
  }, []);

  useEffect(() => {
    if (!chat || !currentUser) {
      return;
    }
    const messageList = messageListRef.current;
    if (messageList) {
        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = messageList;
            const atBottom = scrollHeight - scrollTop - clientHeight < 100;
            setIsAtBottom(atBottom);
            if (atBottom) {
                setNewMessagesCount(0);
            }
        };
        messageList.addEventListener('scroll', handleScroll);
        return () => messageList.removeEventListener('scroll', handleScroll);
    }
  }, [chat, currentUser, messageListRef]);


  useLayoutEffect(() => {
    if (!chat || !currentUser) {
      return;
    }
    const newMessagesAdded = messages.length > prevMessagesLength.current;

    if (newMessagesAdded && messages.length > 0) {
      const lastMessage = messages[messages.length-1];
      // Always scroll to bottom if last message is from AI or current user
      if (lastMessage.senderId === currentUser?.uid || lastMessage.senderId === 'gemini-ai-chat-bot-7a4b9c1d-f2e3-4d56-a1b2-c3d4e5f6a7b8') {
        scrollToBottom();
      } else if (!isAtBottom) {
        setNewMessagesCount(prev => prev + (messages.length - prevMessagesLength.current));
      } else {
        scrollToBottom();
      }
    }
    prevMessagesLength.current = messages.length;
  }, [messages, isAtBottom, currentUser?.uid, chat, currentUser]);
  
  const handleFileSelect = async (file: File) => {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
  
    try {
      if (isImage) {
        setPreviewFile(file);
      } else if (isVideo) {
        // Send video directly to Cloudinary flow
        await activeSendFile(file, "");
      } else {
        // Other files like audio, docs etc.
        await activeSendFile(file, "");
      }
    } catch (error) {
      console.error("Error handling file:", error);
      toast({
        title: "File Error",
        description: "Could not process the selected file.",
        variant: "destructive",
      });
    }
  };
  
  const handleSendFile = async (file: File, message: string) => {
    try {
        await activeSendFile(file, message);
    } catch (error) {
        toast({
            title: "Upload Failed",
            description: "There was a problem sending your file.",
            variant: "destructive",
        });
    }
    setPreviewFile(null);
  };


  const handleSendMessageWithReply = async (messageText: string) => {
    if (!messageText.trim()) return;
    
    try {
        await activeSendMessage(messageText, replyToMessage?.replyTo || (replyToMessage ? {
            messageId: replyToMessage.id,
            messageText: replyToMessage.text || (replyToMessage.file ? 'Attachment' : ''),
            messageSender: usersCache.get(replyToMessage.senderId)?.name || 'Unknown User'
        } : undefined));
        setReplyToMessage(null); // Clear reply state after sending
    } catch (e) {
      toast({
          title: 'Error Sending Message',
          description: 'Could not send your message. Please try again.',
          variant: 'destructive',
      });
    }
  };

  const handleSendGif = (base64: string, fileType: string, fileName: string, caption: string) => {
      activeSendFile(
        new File([Buffer.from(base64.split(',')[1], 'base64')], fileName, { type: fileType }),
        caption
      );
  }


  const getStatusText = () => {
    if (isAiReplying) return 'typing...';
    if (typingUsers.length > 0) {
      if (typingUsers.length === 1) {
        return `${typingUsers[0]} is typing...`;
      }
      if (typingUsers.length === 2) {
        return `${typingUsers[0]} and ${typingUsers[1]} are typing...`;
      }
      return 'several people are typing...';
    }
    if (isAIChat) return 'Online';
    if (chat?.type === 'group') {
      const uniqueParticipants = new Set(chat.participants);
      return `${uniqueParticipants.size} members`;
    }
    return otherParticipant?.status;
  };

  const scrollToBottom = () => {
    if (messageListRef.current) {
        requestAnimationFrame(() => {
            if (messageListRef.current) {
                messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
            }
        });
    }
    setNewMessagesCount(0);
  }

  if (!chat || !currentUser) {
    return (
        <div className="flex h-full flex-1 flex-col items-center justify-center text-muted-foreground bg-transparent">
             <RightPaneBackground />
             <div className="text-center p-8 z-10">
                <h2 className="text-2xl font-bold font-heading">
                    Welcome to{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-gradient-from to-gradient-to animated-gradient">
                        Vibez
                    </span>
                </h2>
                <p className="mt-2">Select a chat to start messaging</p>
             </div>
        </div>
    )
  }
  
  const isAIChat = chat.id === AI_USER_ID;
  const isGroupChat = chat.type === 'group';
  
  const participantForProfile = isAIChat ? usersCache.get(AI_USER_ID) : otherParticipant;

  const displayName = chat.name;
  const displayAvatar = chat.avatar;
  const displayStatus = getStatusText();

  const headerAvatarUser = isGroupChat ? { 
    name: displayName, 
    photoURL: displayAvatar 
  } : (participantForProfile || { 
    name: displayName, 
    photoURL: displayAvatar 
  });


  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <header className="flex items-center justify-between border-b border-border/50 bg-card/80 backdrop-blur-xl p-2 sm:p-4 shrink-0 z-10">
        <div className="flex items-center gap-3">
            {isMobileView && onBack ? (
              <Button variant="ghost" size="icon" className="h-10 w-10" onClick={onBack}>
                <ArrowLeft className="h-6 w-6" />
              </Button>
            ) : (
               <SidebarTrigger className="md:hidden" />
            )}
          <button 
            className="flex items-center gap-3 text-left disabled:cursor-default"
            onClick={() => setIsProfileSheetOpen(true)}
            disabled={!participantForProfile && !isGroupChat}
          >
            <UserAvatar user={headerAvatarUser} className="h-10 w-10"/>
            <div>
              <p className="font-semibold font-heading">{displayName}</p>
              <p className="text-sm text-muted-foreground capitalize flex items-center gap-1">
                  {isAIChat && !isAiReplying && <Bot className="h-3 w-3" />}
                  {displayStatus}
              </p>
            </div>
          </button>
        </div>
        <div className={cn("flex items-center", isAIChat && "hidden")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                    <MoreVertical className="h-5 w-5" />
                    <span className="sr-only">More options</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsProfileSheetOpen(true)}>
                    View Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem
                      onSelect={(e) => e.preventDefault()}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear Chat
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete all messages in this conversation. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleClearChat(chat.id)}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        Clear Chat
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-col h-full min-h-0">
        {/* Chat content area, scrollable above input */}
        <div className="flex-1 min-h-0 overflow-y-auto relative">
         {chatBackground && (
          <div className="absolute inset-0 opacity-20 dark:opacity-10">
             {chatBackground && !chatBackground.startsWith('data:image') && (
                <Image 
                    src={chatBackground}
                    fill
                    style={{objectFit:"cover"}}
                    alt="Chat background"
                />
            )}
             {chatBackground && chatBackground.startsWith('data:image') && (
                <div style={{ backgroundImage: `url(${chatBackground})`}} className="h-full w-full bg-cover bg-center" />
             )}
          </div>
        )}
      <MessageList 
        messages={messages}
        currentUser={currentUser}
        usersCache={usersCache}
        uploadProgress={uploadProgress}
        onCancelUpload={cancelUpload}
        onMessageAction={handleMessageAction}
        onReply={onReply}
        isAiReplying={isAiReplying}
        otherParticipantLastRead={chat.otherParticipantLastRead}
        onLoadMore={loadMoreMessages}
        hasMore={hasMoreMessages}
        isLoadingMore={isLoadingMore}
        ref={messageListRef}
        chatId={chat.id}
      />
      {newMessagesCount > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
          <Button onClick={scrollToBottom} className="rounded-full shadow-lg">
            <ArrowDown className="mr-2 h-4 w-4"/>
            {newMessagesCount} New Message{newMessagesCount > 1 && 's'}
          </Button>
        </div>
      )}
    </div>
    {/* Message input sticky to bottom for mobile */}
    <div className="sticky bottom-0 left-0 w-full bg-background z-30">
      {replyToMessage && (
        <div className="p-2 px-4 border-t border-border/50 bg-background/50 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Reply className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-semibold">{replyToMessage.senderId === currentUser.uid ? "You" : usersCache.get(replyToMessage.senderId)?.name}</p>
              <p className="text-muted-foreground truncate max-w-xs">{replyToMessage.text}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setReplyToMessage(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      <MessageInput
        onSendMessage={handleSendMessageWithReply}
        onFileSelect={handleFileSelect}
        onGifSelect={handleSendGif}
        onTyping={handleTyping}
        isAiChat={isAIChat}
      />
    </div>
    </div>
      
      {isGroupChat ? (
          <GroupProfileSheet 
            chat={chat}
            currentUser={currentUser}
            isOpen={isProfileSheetOpen}
            onOpenChange={setIsProfileSheetOpen}
            usersCache={usersCache}
          />
      ) : participantForProfile ? (
        <UserProfileSheet
          user={participantForProfile}
          currentUser={currentUser}
          chatId={chat.id}
          isOpen={isProfileSheetOpen}
          onOpenChange={setIsProfileSheetOpen}
          onFriendAction={handleFriendAction}
          onBlockUser={handleBlockUser}
          onMuteToggle={handleMuteToggle}
        />
      ) : null}


      {previewFile && (
        <ImagePreviewDialog
            file={previewFile}
            onSend={handleSendFile}
            onCancel={() => setPreviewFile(null)}
            mode="chat"
        />
      )}
    </div>
  );
};

export const ChatView = memo(ChatViewComponent);
