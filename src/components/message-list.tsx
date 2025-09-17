
'use client';
import { useEffect, useRef, memo, Fragment, forwardRef, UIEvent, useState, useLayoutEffect } from 'react';
import { motion } from 'framer-motion';
import { ScrollArea } from './ui/scroll-area';
import { Timestamp } from 'firebase/firestore';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { MessageBubble } from './message-bubble';
import { User, Message } from '@/lib/types';
import { UserAvatar } from './user-avatar';


const AI_USER_ID = 'gemini-ai-chat-bot-7a4b9c1d-f2e3-4d56-a1b2-c3d4e5f6a7b8';

const messageListVariants = {
    initial: { opacity: 0 },
    animate: {
        opacity: 1,
        transition: {
            staggerChildren: 0.12,
            type: 'spring',
            bounce: 0.3,
            duration: 0.6
        }
    }
};

const MemoizedMessageBubble = memo(MessageBubble);

interface MessageListProps {
    messages: Message[];
    currentUser: User;
    usersCache: Map<string, User>;
    uploadProgress: Map<string, number>;
    onCancelUpload: (messageId: string) => void;
    onMessageAction: (messageId: string, action: 'react' | 'delete', data?: any) => void;
    onReply: (message: Message) => void;
    isAiReplying: boolean;
    otherParticipantLastRead?: Timestamp;
    onLoadMore: () => Promise<void>;
    hasMore: boolean;
    isLoadingMore: boolean;
    chatId: string;
}

function convertToDate(timestamp: any): Date | null {
    if (!timestamp) return null;
    if (timestamp instanceof Timestamp) return timestamp.toDate();
    if (timestamp instanceof Date) return timestamp;
    if (typeof timestamp === 'string') return new Date(timestamp);
    if (timestamp?.seconds) return new Date(timestamp.seconds * 1000);
    return null;
}

function formatDateSeparator(date: Date): string {
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'MMMM d, yyyy');
}


export const MessageList = forwardRef<HTMLDivElement, MessageListProps>(({
    messages,
    currentUser,
    usersCache,
    uploadProgress,
    onCancelUpload,
    onMessageAction,
    onReply,
    isAiReplying,
    otherParticipantLastRead,
    onLoadMore,
    hasMore,
    isLoadingMore,
    chatId,
}, ref) => {
    
    const viewportRef = useRef<HTMLDivElement>(null);
    const [isManualLoading, setIsManualLoading] = useState(false);
    const prevChatId = useRef(chatId);
    const [scrollAnchor, setScrollAnchor] = useState<{ top: number; height: number } | null>(null);
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    const visibleMessages = messages.filter(message => {
        const blockedUsers = currentUser?.blockedUsers || [];
        return !blockedUsers.includes(message.senderId);
    });

    useEffect(() => {
        if (chatId !== prevChatId.current) {
            setIsInitialLoad(true);
            prevChatId.current = chatId;
        }
    }, [chatId]);


    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        if (isInitialLoad && viewport && messages.length > 0) {
            viewport.scrollTop = viewport.scrollHeight;
            setIsInitialLoad(false);
        }

        if (scrollAnchor && viewport) {
            viewport.scrollTop = scrollAnchor.top + (viewport.scrollHeight - scrollAnchor.height);
            setScrollAnchor(null);
        }
    }, [messages, isInitialLoad, scrollAnchor]);
    
    
    const handleLoadMore = async () => {
        if (!viewportRef.current || isLoadingMore) return;

        setScrollAnchor({
            top: viewportRef.current.scrollTop,
            height: viewportRef.current.scrollHeight,
        });
        
        setIsManualLoading(true);

        try {
            await onLoadMore();
        } finally {
            setIsManualLoading(false);
        }
    };
    
    const getParticipantDetails = (senderId: string) => {
        if (senderId === currentUser.uid) return currentUser;
        return usersCache.get(senderId);
    }

    return (
        <ScrollArea className="h-full" viewportRef={ref as React.RefObject<HTMLDivElement>}>
            <div ref={viewportRef}>
                <motion.div 
                    className="p-4 space-y-6"
                    variants={messageListVariants}
                    initial="initial"
                    animate="animate"
                    layout
                >
                    {hasMore && (
                        <motion.div 
                          className="flex justify-center" 
                          initial={{ opacity: 0, y: -10 }} 
                          animate={{ opacity: 1, y: 0 }} 
                          transition={{ duration: 0.4 }}
                        >
                            <Button
                                variant="secondary"
                                onClick={handleLoadMore}
                                disabled={isManualLoading || isLoadingMore}
                            >
                                {(isManualLoading || isLoadingMore) ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : null}
                                Load Older Messages
                            </Button>
                        </motion.div>
                    )}
                    {visibleMessages.length > 0 ? (
                    visibleMessages.map((message, index) => {
                        const sender = getParticipantDetails(message.senderId);
                        let isRead = false;
                        if(otherParticipantLastRead && message.timestamp && message.senderId === currentUser.uid) {
                            const messageDate = convertToDate(message.timestamp);
                            const lastReadDate = convertToDate(otherParticipantLastRead);
                            if (messageDate && lastReadDate) {
                                isRead = messageDate <= lastReadDate;
                            }
                        }
                        let dateSeparator = null;
                        const currentMessageDate = convertToDate(message.timestamp);
                        if (currentMessageDate) {
                            if (index === 0) {
                                dateSeparator = formatDateSeparator(currentMessageDate);
                            } else {
                                const prevMessageDate = convertToDate(visibleMessages[index - 1].timestamp);
                                if (prevMessageDate && !isSameDay(currentMessageDate, prevMessageDate)) {
                                    dateSeparator = formatDateSeparator(currentMessageDate);
                                }
                            }
                        }
                        return (
                            <Fragment key={message.id || message.clientTempId}>
                                {dateSeparator && (
                                    <motion.div 
                                      className="relative text-center my-4" 
                                      initial={{ opacity: 0, y: -10 }} 
                                      animate={{ opacity: 1, y: 0 }} 
                                      transition={{ duration: 0.4 }}
                                    >
                                        <hr className="absolute top-1/2 left-0 w-full -translate-y-1/2" />
                                        <span className="relative bg-background px-2 text-xs text-muted-foreground">{dateSeparator}</span>
                                    </motion.div>
                                )}
                                {message && sender ? (
                                    <MemoizedMessageBubble
                                        message={message}
                                        sender={sender}
                                        isCurrentUser={sender?.uid === currentUser.uid}
                                        progress={uploadProgress.get(message.clientTempId || message.id)}
                                        onCancelUpload={() => onCancelUpload(message.clientTempId || message.id)}
                                        onMessageAction={onMessageAction}
                                        onReply={onReply}
                                        isRead={isRead}
                                    />
                                ) : (
                                    <div className="text-muted-foreground text-xs px-2 py-1">Invalid message data.</div>
                                )}
                            </Fragment>
                        );
                    })
                    ) : (
                    <motion.div 
                      className="flex justify-center items-center h-full" 
                      initial={{ opacity: 0 }} 
                      animate={{ opacity: 1 }} 
                      transition={{ duration: 0.5 }}
                    >
                        <div className="text-center p-4 rounded-lg bg-background/50">
                        <p className="text-muted-foreground">
                            No messages in this chat yet.
                        </p>
                        </div>
                    </motion.div>
                    )}
                    {isAiReplying && (
                    <motion.div 
                      className="flex items-start gap-3" 
                      initial={{ opacity: 0, scale: 0.8 }} 
                      animate={{ opacity: 1, scale: 1 }} 
                      transition={{ type: 'spring', bounce: 0.5, duration: 0.5 }}
                    >
                        <UserAvatar user={usersCache.get(AI_USER_ID)!} className="h-8 w-8" />
                        <div className="bg-card/80 backdrop-blur-sm rounded-xl px-4 py-2 rounded-tl-none flex items-center gap-2">
                        <span className="h-2 w-2 bg-muted-foreground rounded-full animate-pulse delay-0"></span>
                        <span className="h-2 w-2 bg-muted-foreground rounded-full animate-pulse delay-150"></span>
                        <span className="h-2 w-2 bg-muted-foreground rounded-full animate-pulse delay-300"></span>
                        </div>
                    </motion.div>
                    )}
                </motion.div>
            </div>
        </ScrollArea>
    );
});
MessageList.displayName = 'MessageList';

    

    