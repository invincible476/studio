
'use client';
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, Timestamp, updateDoc, where, writeBatch, limit, startAfter, setDoc
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable, UploadTask } from 'firebase/storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { continueConversation } from '@/ai/flows/ai-chat-flow';
import { useAuth } from '@/hooks/use-auth';
import { useNotifications } from '@/hooks/use-notifications';
import { db, storage } from '@/lib/firebase';
import type { Conversation, Message, Story, User, StoryReaction } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { StoryViewer } from './story-viewer';
import { StoriesContext } from './providers/stories-provider';
import { ImagePreviewDialog } from './image-preview-dialog';
import { useAppearance } from './providers/appearance-provider';
import { GalaxyBackground } from './galaxy-background';
import { GradientGlowBackground } from './gradient-glow-background';
import { AuraBackground } from './aura-background';
import { GridBackground } from './grid-background';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileGalaxyBackground } from './mobile-galaxy-background';


const AI_USER_ID = 'gemini-ai-chat-bot-7a4b9c1d-f2e3-4d56-a1b2-c3d4e5f6a7b8';
const AI_USER_NAME = 'Gemini';
const AI_AVATAR_URL = '/gemini-logo.svg';

const PAGE_SIZE = 30;

export async function uploadToCloudinaryXHR(
  file: File,
  cloudName: string,
  uploadPreset: string,
  onProgress?: (p: number) => void,
  signal?: { xhrAbort?: () => void }
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress((ev.loaded / ev.total) * 100);
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Invalid JSON response from Cloudinary')); }
        } else {
          reject(new Error(`Cloudinary upload failed: ${xhr.status} ${xhr.responseText}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during Cloudinary upload'));
    xhr.send(formData);

    if (signal) signal.xhrAbort = () => { try { xhr.abort(); } catch(e){} };
  });
}


function useChatData() {
  const { user: authUser, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { setAppBackground, setUseCustomBackground } = useAppearance();

  const aiUser: User = {
    id: AI_USER_ID,
    uid: AI_USER_ID,
    name: AI_USER_NAME,
    photoURL: AI_AVATAR_URL,
    status: 'online',
  };

  const initialAiConversation: Conversation = {
    id: AI_USER_ID,
    type: 'private',
    participants: [AI_USER_ID],
    participantsDetails: [aiUser],
    name: AI_USER_NAME,
    avatar: AI_AVATAR_URL,
    messages: [],
    lastMessage: {
      text: 'Ask me anything!',
      senderId: AI_USER_ID,
      timestamp: new Date() as any,
    }
  };

  const [aiConversation, setAiConversation] = useState<Conversation>(initialAiConversation);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedChat, setSelectedChat] = useState<Conversation | undefined>(undefined);
  const [isAiReplying, setIsAiReplying] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [usersCache, setUsersCache] = useState<Map<string, User>>(new Map([[AI_USER_ID, aiUser]]));
  const [newlyCreatedChatId, setNewlyCreatedChatId] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map());
  const uploadTasks = useRef<Map<string, UploadTask>>(new Map());
  const xhrRequests = useRef<Map<string, { xhrAbort?: () => void }>>(new Map());


  
  const [currentUser, setCurrentUser] = useState<User | undefined>(undefined);
  const [stories, setStories] = useState<Story[]>([]);
  const [viewingStory, setViewingStory] = useState<{ user: User, stories: Story[] } | null>(null);
  const [previewStoryFile, setPreviewStoryFile] = useState<File | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [firstMessageDoc, setFirstMessageDoc] = useState<any>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  const messagesUnsubscribe = useRef<() => void>();


  useNotifications({ conversations, usersCache, currentUser, activeChatId: selectedChat?.id });

  const updateUserInCache = useCallback((userToCache: User) => {
    setUsersCache(prev => {
      const newCache = new Map(prev);
      const existingUser = newCache.get(userToCache.uid);
      if (JSON.stringify(existingUser) !== JSON.stringify(userToCache)) {
        newCache.set(userToCache.uid, userToCache);
        return newCache;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!authUser || authLoading) return;
    
    const userDocRef = doc(db, 'users', authUser.uid);
    const unsubscribeCurrentUser = onSnapshot(userDocRef, (doc) => {
        if (doc.exists()) {
            const userData = { id: doc.id, ...doc.data() } as User;
            setCurrentUser(userData);
            updateUserInCache(userData);
            // Update appearance from user data
            if(userData.background) {
              setAppBackground(userData.background);
            }
            if(userData.hasOwnProperty('useCustomBackground')) {
              setUseCustomBackground(userData.useCustomBackground);
            }
        }
    });
    
    const usersQuery = query(collection(db, 'users'));
    const unsubscribeAllUsers = onSnapshot(usersQuery, (snapshot) => {
      const usersData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as User));
      const newCache = new Map(usersCache);
      usersData.forEach(user => newCache.set(user.uid, user));
      setUsersCache(newCache);
      setAllUsers(usersData);
    }, (error) => console.error("Error fetching all users:", error));

    return () => {
      unsubscribeCurrentUser();
      unsubscribeAllUsers();
    };
  }, [authUser, authLoading, updateUserInCache, setAppBackground, setUseCustomBackground]);


  const getParticipantDetails = useCallback((participantIds: string[]): User[] => {
    return participantIds.map(id => usersCache.get(id)).filter(Boolean) as User[];
  }, [usersCache]);


  useEffect(() => {
    if (!authUser || usersCache.size <= 1) return;

    const conversationsQuery = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', authUser.uid)
    );

    const unsubscribeConversations = onSnapshot(conversationsQuery, async (snapshot) => {
      const convosPromises = snapshot.docs.map(async (doc) => {
          const data = doc.data() as Omit<Conversation, 'id'|'participantsDetails'>;
          const participantIds = data.participants;
          const participantsDetails = getParticipantDetails(participantIds);
          let name = data.name;
          let avatar = data.avatar;
          let otherParticipantLastRead: Timestamp | undefined = undefined;

          if (data.type === 'private') {
              const otherParticipant = participantsDetails.find(p => p.uid !== authUser.uid);
              if (otherParticipant) {
                  name = otherParticipant.name;
                  avatar = otherParticipant.photoURL;
                  if(data.lastRead) {
                    otherParticipantLastRead = data.lastRead[otherParticipant.uid];
                  }
              }
          }
          
          let unreadCount = 0;
          const lastReadTimestamp = data.lastRead?.[authUser.uid];
          if (data.lastMessage && lastReadTimestamp && data.lastMessage.timestamp > lastReadTimestamp) {
              // This is a simplified unread count. A more accurate one would query messages.
              // For performance, we can assume 1 unread if last message is newer.
              unreadCount = data.lastMessage.senderId !== authUser.uid ? 1 : 0;
          } else if (data.lastMessage && !lastReadTimestamp && data.lastMessage.senderId !== authUser.uid) {
              unreadCount = 1;
          }

          return {
              ...data,
              id: doc.id,
              name,
              avatar,
              participantsDetails,
              unreadCount,
              otherParticipantLastRead,
          } as Conversation
      });

      const convos = await Promise.all(convosPromises);
      convos.sort((a, b) => (b.lastMessage?.timestamp?.toMillis() || 0) - (a.lastMessage?.timestamp?.toMillis() || 0));
      
      setConversations(convos);

    });

    return () => unsubscribeConversations();
  }, [authUser, usersCache, getParticipantDetails]);
  
  useEffect(() => {
     if (newlyCreatedChatId) {
        const newChat = conversations.find(c => c.id === newlyCreatedChatId);
        if (newChat) {
          handleChatSelect(newChat.id);
          setNewlyCreatedChatId(null);
        }
      }
  }, [conversations, newlyCreatedChatId]);


  // Message fetching logic
  const handleChatSelect = useCallback(async (chatId: string) => {
    if (messagesUnsubscribe.current) {
        messagesUnsubscribe.current();
    }

    const chat = conversations.find(c => c.id === chatId) || (chatId === AI_USER_ID ? aiConversation : undefined);

    if (!chat) {
        setSelectedChat(undefined);
        setMessages([]);
        return;
    }

    if (chat.id === AI_USER_ID) {
        setSelectedChat(aiConversation);
        setMessages(aiConversation.messages || []);
        setHasMoreMessages(false);
        return;
    }
    
    setSelectedChat(chat);
    setIsLoadingMore(true);

    const messagesRef = collection(db, 'conversations', chat.id, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(PAGE_SIZE));
    const snapshot = await getDocs(q);

    const initialMsgs = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Message)).reverse();
    setMessages(initialMsgs);

    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
    setFirstMessageDoc(lastDoc);
    setHasMoreMessages(snapshot.docs.length === PAGE_SIZE);
    setIsLoadingMore(false);
    
    if (chat && authUser) {
        const chatRef = doc(db, 'conversations', chat.id);
        await updateDoc(chatRef, {
            [`lastRead.${authUser.uid}`]: serverTimestamp()
        });
    }

    // Subscribe to new messages
    const lastVisibleMessage = initialMsgs[initialMsgs.length - 1];
    const newMessagesQuery = lastVisibleMessage?.timestamp
        ? query(messagesRef, orderBy('timestamp', 'asc'), startAfter(lastVisibleMessage.timestamp))
        : query(messagesRef, orderBy('timestamp', 'asc'));

    messagesUnsubscribe.current = onSnapshot(newMessagesQuery, (snapshot) => {
        const newMsgs: Message[] = [];
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                newMsgs.push({ ...change.doc.data(), id: change.doc.id } as Message);
            }
        });

        if (newMsgs.length > 0) {
            setMessages(prev => {
                const newMessagesMap = new Map(newMsgs.map(m => [m.clientTempId || m.id, m]));
                const updatedMessages = prev.map(m => {
                    const serverVersion = newMessagesMap.get(m.clientTempId!);
                    if (serverVersion) {
                        newMessagesMap.delete(m.clientTempId!);
                        return serverVersion; // Replace optimistic with server version
                    }
                    return m;
                });
                return [...updatedMessages, ...Array.from(newMessagesMap.values())];
            });
        }
    });

  }, [conversations, aiConversation, authUser]);
  
  const loadMoreMessages = useCallback(async () => {
    if (isLoadingMore || !hasMoreMessages || !selectedChat || !firstMessageDoc) return;
  
    setIsLoadingMore(true);
  
    const messagesRef = collection(db, 'conversations', selectedChat.id, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), startAfter(firstMessageDoc), limit(PAGE_SIZE));
    
    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            setHasMoreMessages(false);
            setIsLoadingMore(false);
            return;
        }

        const olderMsgs = snapshot.docs.map(d => ({...d.data(), id: d.id} as Message)).reverse();
        const newFirstDoc = snapshot.docs[snapshot.docs.length - 1];
        setFirstMessageDoc(newFirstDoc);
        setHasMoreMessages(snapshot.docs.length === PAGE_SIZE);

        setMessages(prev => [...olderMsgs, ...prev]);

    } catch (error) {
      console.error("Error loading more messages:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMoreMessages, selectedChat, firstMessageDoc]);


  useEffect(() => {
    if (!currentUser) {
        setStories([]);
        return;
    };
    
    const storyOwnerIds = [...(currentUser.friends || []), currentUser.uid];

    if(storyOwnerIds.length === 0) {
      setStories([]);
      return;
    }

    const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerId', 'in', storyOwnerIds)
    );

    const unsubscribe = onSnapshot(storiesQuery, (snapshot) => {
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        
        const stories = snapshot.docs
          .map(d => ({id: d.id, ...d.data()} as Story))
          .filter(story => (story.createdAt as Timestamp).toDate() > twentyFourHoursAgo);
        
        setStories(stories);
    }, error => {
      console.error("Error fetching stories: ", error);
    });

    return () => unsubscribe();

  }, [currentUser]);
  
  const handleSendMessage = useCallback(async (
    chatId: string,
    senderId: string,
    messageText: string,
    replyTo?: Message['replyTo']
  ): Promise<string> => {
    if (!messageText.trim() || !currentUser) return Promise.reject("Cannot send empty message");
  
    const tempId = uuidv4();
    const optimisticMessage: Message = {
        id: tempId,
        clientTempId: tempId,
        senderId: currentUser.uid,
        text: messageText,
        timestamp: new Date(),
        status: 'sending',
        ...(replyTo && { replyTo })
    };

    setMessages(prev => [...prev, optimisticMessage]);

    const messageCollectionRef = collection(db, 'conversations', chatId, 'messages');
    const newMessageRef = doc(messageCollectionRef);
    const messageData: any = {
      senderId: senderId,
      text: messageText,
      timestamp: serverTimestamp(),
      clientTempId: tempId,
    };
    if (replyTo) messageData.replyTo = replyTo;
    
    const chatRef = doc(db, 'conversations', chatId);

    writeBatch(db)
      .set(newMessageRef, messageData)
      .update(chatRef, {
          lastMessage: {
              text: messageText,
              senderId: senderId,
              timestamp: serverTimestamp(),
          },
      })
      .commit()
      .catch(error => {
          console.error('Error sending message: ', error);
          setMessages(prev => prev.map(m => 
              m.clientTempId === tempId ? { ...m, status: 'error' } : m
          ));
      });
    
    return tempId;
  
  }, [currentUser]);

  const handleSendBase64File = useCallback(async (chatId: any, senderId: any, base64Data: any, fileType: any, fileName: any, caption: any) => {
    if (!base64Data || !currentUser) return Promise.reject("No data or user");
    if (fileType.startsWith('video/')) {
        // Prevent regressions: videos must not be stored as base64
        toast({ title: "Error", description: "Video uploads must use Cloudinary. Do not send base64 for videos.", variant: "destructive"});
        return Promise.reject('Video uploads must use Cloudinary. Do not send base64 for videos.');
    }
    
    if (!base64Data || !currentUser) return;
    
    const tempId = uuidv4();
    const optimisticMessage: Message = {
        id: tempId,
        clientTempId: tempId,
        senderId,
        text: caption,
        timestamp: new Date(),
        status: 'sending',
        file: {
            url: base64Data, // Use data URL for optimistic preview
            type: fileType,
            name: fileName
        }
    };

    setMessages(prev => [...prev, optimisticMessage]);

    const messageData: any = {
        senderId,
        text: caption,
        timestamp: serverTimestamp(),
        clientTempId: tempId,
        file: {
            url: base64Data, 
            type: fileType,
            name: fileName
        }
    };

    try {
        const messageCollectionRef = collection(db, 'conversations', chatId, 'messages');
        const newMessageRef = doc(messageCollectionRef);
        await setDoc(newMessageRef, messageData);
        
        let lastMessageText = caption ? caption : 'Sent a file';
        if (fileType.startsWith('image/')) {
            lastMessageText = caption || 'Sent an image';
        } else if (fileType.startsWith('audio/')) {
             lastMessageText = 'Sent a voice note';
        } else if (fileType.startsWith('video/')) {
             lastMessageText = caption || 'Sent a video';
        }
        
        await updateDoc(doc(db, 'conversations', chatId), {
            lastMessage: {
                text: lastMessageText,
                senderId: senderId,
                timestamp: serverTimestamp(),
            },
        });
    } catch (error) {
        console.error('Error sending base64 file:', error);
        setMessages(prev => prev.map(m => m.clientTempId === tempId ? {...m, status: 'error'} : m));
        throw error;
    }
  }, [currentUser, toast]);


  const handleAiConversation = useCallback(async (messageText: string) => {
    if (!currentUser) return;

    const userMessage: Message = {
      id: uuidv4(),
      senderId: currentUser.uid,
      text: messageText,
      timestamp: new Date(),
      status: 'read',
    };
    
    // Optimistically update AI chat
    setAiConversation(prev => ({
        ...prev,
        messages: [...(prev.messages || []), userMessage],
        lastMessage: { text: messageText, senderId: currentUser.uid, timestamp: new Date() as any }
    }));
    setMessages(prev => [...prev, userMessage]);
    
    setIsAiReplying(true);

    try {
      const history = (aiConversation.messages || [])
          .concat(userMessage) // include the latest message
          .slice(-10) 
          .filter(m => !!m.text) // Ensure only text messages are included
          .map(m => (m.senderId === currentUser.uid ? { user: m.text } : { model: m.text }));

      const aiResponse = await continueConversation({ message: messageText, history });

      const aiMessage: Message = {
        id: uuidv4(),
        senderId: AI_USER_ID,
        text: aiResponse.reply,
        timestamp: new Date(),
        status: 'read',
      };
      
      setAiConversation(prev => {
          const newMessages = [...(prev.messages || []), aiMessage];
          const finalAiConvo = {
            ...prev,
            messages: newMessages,
            lastMessage: { text: aiResponse.reply, senderId: AI_USER_ID, timestamp: new Date() as any }
          };
          // If the AI chat is still selected, update the main messages state and selected chat
          if (selectedChat?.id === AI_USER_ID) {
              setMessages(newMessages);
              setSelectedChat(finalAiConvo);
          }
          return finalAiConvo;
      });

    } catch (error: any) {
      console.error("Error with AI conversation:", error);
       const errorMessage: Message = {
          id: uuidv4(),
          senderId: AI_USER_ID,
          text: error.message || "Sorry, I encountered an error. Please try again.",
          timestamp: new Date(),
          status: 'read',
        };
       setAiConversation(prev => {
          const newMessages = [...(prev.messages || []), errorMessage];
          const finalAiConvo = { ...prev, messages: newMessages };
          if (selectedChat?.id === AI_USER_ID) {
              setMessages(newMessages);
              setSelectedChat(finalAiConvo);
          }
          return finalAiConvo;
        });
    } finally {
      setIsAiReplying(false);
    }
  }, [currentUser, aiConversation, selectedChat?.id]);
  
  const handleCloudinaryUpload = useCallback(async (file: File, messageText: string, chatId: string, senderId: string): Promise<string> => {
    const tempId = uuidv4();
    const optimisticMessage: Message = {
        id: tempId, clientTempId: tempId, senderId,
        text: messageText, timestamp: new Date(), status: 'sending',
        file: { url: URL.createObjectURL(file), type: file.type, name: file.name }
    };
    setMessages(prev => [...prev, optimisticMessage]);

    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
        setMessages(prev => prev.map(m => m.clientTempId === tempId ? {...m, status: 'error'} : m));
        toast({ title: 'Cloudinary config missing', variant: 'destructive' });
        return Promise.reject('Cloudinary config missing');
    }

    let xhrSignal: { xhrAbort?: ()=>void } = {};
    xhrRequests.current.set(tempId, xhrSignal);
    try {
        const { secure_url, resource_type, duration } = await uploadToCloudinaryXHR(file, cloudName, uploadPreset, (p) => {
            setUploadProgress(prev => new Map(prev).set(tempId, p));
        }, xhrSignal);

        const fileData: Message['file'] = {
            url: secure_url,
            type: file.type,
            name: file.name,
        };
        
        if (resource_type === 'video' && duration) {
            fileData.duration = duration;
        }

        const finalMessageData = {
            senderId,
            text: messageText || '',
            timestamp: serverTimestamp(),
            clientTempId: tempId,
            file: fileData,
        };

        const messageCollectionRef = collection(db, 'conversations', chatId, 'messages');
        await addDoc(messageCollectionRef, finalMessageData);
        await updateDoc(doc(db, 'conversations', chatId), { lastMessage: { text: messageText || `Sent a ${file.type.split('/')[0]}`, senderId, timestamp: serverTimestamp() } });

        xhrRequests.current.delete(tempId);
        setUploadProgress(prev => { const n = new Map(prev); n.delete(tempId); return n; });
        return tempId;
    } catch (err) {
        console.error('Cloudinary upload error', err);
        setMessages(prev => prev.map(m => m.clientTempId === tempId ? {...m, status: 'error'} : m));
        xhrRequests.current.delete(tempId);
        setUploadProgress(prev => { const n = new Map(prev); n.delete(tempId); return n; });
        throw err;
    }
  }, [toast]);

  const handleFileUpload = useCallback(async (file: File, messageText: string, chatId: string, senderId: string): Promise<string> => {
      // Videos, Images, Audio, GIFs -> Cloudinary
      if (file.type.startsWith('video/') || file.type.startsWith('image/') || file.type.startsWith('audio/')) {
        return handleCloudinaryUpload(file, messageText, chatId, senderId);
      }
    
      // Other files -> Firebase Storage
      const tempId = uuidv4();
      const optimisticMessage: Message = {
          id: tempId,
          clientTempId: tempId,
          senderId: senderId,
          text: messageText,
          timestamp: new Date(),
          status: 'sending',
          file: {
              url: URL.createObjectURL(file),
              type: file.type,
              name: file.name
          }
      };

      setMessages(prev => [...prev, optimisticMessage]);
  
      const fileId = `${Date.now()}_${file.name}`;
      const storageRef = ref(storage, `uploads/${chatId}/${fileId}`);
      const metadata = { contentType: file.type };
      
      const uploadTask = uploadBytesResumable(storageRef, file, metadata);
      uploadTasks.current.set(tempId, uploadTask);
    
      uploadTask.on('state_changed', 
          (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(prev => new Map(prev).set(tempId, progress));
          },
          (error) => {
              console.error('Upload error:', error);
              setMessages(prev => prev.map(m => m.clientTempId === tempId ? {...m, status: 'error'} : m));
              uploadTasks.current.delete(tempId);
          },
          async () => {
              try {
                  const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                  
                  const finalMessageData = {
                    senderId: senderId,
                    text: messageText,
                    timestamp: serverTimestamp(),
                    clientTempId: tempId,
                    file: {
                        url: downloadURL,
                        type: file.type,
                        name: file.name,
                    },
                  };
                  
                  const messageCollectionRef = collection(db, 'conversations', chatId, 'messages');
                  await addDoc(messageCollectionRef, finalMessageData);
  
                  const lastMessageText = messageText || `Sent a file: ${file.name}`;
  
                  const chatRef = doc(db, 'conversations', chatId);
                  await updateDoc(chatRef, {
                      lastMessage: {
                          text: lastMessageText,
                          senderId: senderId,
                          timestamp: serverTimestamp(),
                      },
                  });
              } catch(e) {
                  console.error('Error saving message after upload:', e);
                  setMessages(prev => prev.map(m => m.clientTempId === tempId ? {...m, status: 'error'} : m));
              } finally {
                  uploadTasks.current.delete(tempId);
                  setUploadProgress(prev => {
                      const newMap = new Map(prev);
                      newMap.delete(tempId);
                      return newMap;
                  });
              }
          }
      );
        
      return tempId;
  }, [handleCloudinaryUpload, toast]);
  
  const cancelUpload = useCallback((messageId: string) => {
    const firebaseTask = uploadTasks.current.get(messageId);
    if (firebaseTask) {
      firebaseTask.cancel();
      uploadTasks.current.delete(messageId);
    }
    
    const cloudinaryXhrSignal = xhrRequests.current.get(messageId);
    if (cloudinaryXhrSignal?.xhrAbort) {
        cloudinaryXhrSignal.xhrAbort();
        xhrRequests.current.delete(messageId);
    }
    
    setMessages(prev => prev.filter(m => m.clientTempId !== messageId));
  }, []);


  const handleCreateChat = useCallback(async (targetUser: User): Promise<string> => {
    if (!currentUser) return Promise.reject("No current user");
  
    const participants = [currentUser.uid, targetUser.uid].sort();
  
    const q = query(collection(db, "conversations"),
      where("type", "==", "private"),
      where("participants", "==", participants)
    );
  
    const querySnapshot = await getDocs(q);
  
    if (!querySnapshot.empty) {
      const existingConvoDoc = querySnapshot.docs[0];
      handleChatSelect(existingConvoDoc.id);
      return existingConvoDoc.id;
    } else {
      try {
        const newConvoRef = await addDoc(collection(db, 'conversations'), {
          type: 'private',
          participants: participants,
          createdAt: serverTimestamp(),
          lastMessage: null,
          lastRead: {}
        });
        setNewlyCreatedChatId(newConvoRef.id);
        return newConvoRef.id;
      } catch (error) {
        console.error("Error creating new chat:", error);
        return Promise.reject(error);
      }
    }
  }, [currentUser, handleChatSelect, conversations]);
  
  const handleCreateGroupChat = useCallback(async (groupName: string, selectedUsers: User[]) => {
    if (!currentUser) return;
  
    const participantUids = [currentUser.uid, ...selectedUsers.map(u => u.uid)].sort();
  
    const newConvoData = {
      type: 'group',
      name: groupName,
      participants: participantUids,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      lastMessage: null,
      avatar: null,
      lastRead: {}
    };
  
    const newConvoRef = await addDoc(collection(db, 'conversations'), newConvoData);
    setNewlyCreatedChatId(newConvoRef.id);
  }, [currentUser]);

  const handleConversationAction = useCallback(async (
    conversationId: string,
    action: 'toggleFavorite' | 'archive' | 'unarchive'
  ) => {
    const conversation = conversations.find(c => c.id === conversationId);
    if (!conversation) return;

    const conversationRef = doc(db, 'conversations', conversationId);

    if (action === 'toggleFavorite') {
      await updateDoc(conversationRef, {
        isFavorite: !conversation.isFavorite,
      });
    } else if (action === 'archive') {
      await updateDoc(conversationRef, {
        isArchived: true,
      });
      if (selectedChat?.id === conversationId) {
        setSelectedChat(undefined);
      }
    } else if (action === 'unarchive') {
        await updateDoc(conversationRef, {
            isArchived: false,
        });
    }
  }, [conversations, selectedChat?.id]);

 const handleMessageAction = useCallback(async (
    messageId: string,
    action: 'react' | 'delete',
    data?: any
  ) => {
    if (!selectedChat || !currentUser) return;
    
    if (action === 'delete') {
      const messageToDelete = messages.find(m => m.id === messageId || m.clientTempId === messageId);
      if (!messageToDelete) return;
      
      const messageRef = doc(db, 'conversations', selectedChat.id, 'messages', messageToDelete.id);
      try {
        await updateDoc(messageRef, {
          text: 'This message was deleted.',
          file: null,
          deleted: true,
          reactions: []
        });
      } catch (error) {
        console.error("Error deleting message", error);
      }
      return;
    }

    if (action === 'react') {
      const emoji = data;
      
      setMessages(prevMessages => prevMessages.map(msg => {
          if (msg.id === messageId) {
              const reactions = msg.reactions || [];
              let existingReaction = reactions.find(r => r.emoji === emoji);
              let newReactions;

              if (existingReaction) {
                  const userIndex = existingReaction.users.indexOf(currentUser!.uid);
                  if (userIndex > -1) {
                      existingReaction.users.splice(userIndex, 1);
                      existingReaction.count--;
                  } else {
                      existingReaction.users.push(currentUser!.uid);
                      existingReaction.count++;
                  }
                  newReactions = reactions.filter(r => r.count > 0);
              } else {
                  newReactions = [...reactions, { emoji, users: [currentUser!.uid], count: 1 }];
              }
              return { ...msg, reactions: newReactions };
          }
          return msg;
      }));

      const messageRef = doc(db, 'conversations', selectedChat.id, 'messages', messageId);
      try {
        await runTransaction(db, async (transaction) => {
          const messageDoc = await transaction.get(messageRef);
          if (!messageDoc.exists()) return;
          const messageData = messageDoc.data() as Message;
          let reactions = messageData.reactions || [];
          let existingReaction = reactions.find(r => r.emoji === emoji);

          if (existingReaction) {
            const userIndex = existingReaction.users.indexOf(currentUser.uid);
            if (userIndex > -1) {
                existingReaction.users.splice(userIndex, 1);
                existingReaction.count--;
            } else {
                existingReaction.users.push(currentUser.uid);
                existingReaction.count++;
            }
          } else {
            reactions.push({ emoji, users: [currentUser.uid], count: 1 });
          }
          
          const finalReactions = reactions.filter(r => r.count > 0);
          transaction.update(messageRef, { reactions: finalReactions });
        });
      } catch (error) {
        console.error("Error reacting to message", error);
        setMessages(messages);
      }
    }
  }, [selectedChat, currentUser, messages]);

  const handleFriendAction = useCallback(async (targetUserId: string, action: 'sendRequest' | 'acceptRequest' | 'declineRequest' | 'removeFriend') => {
    if (!currentUser) return;
    const currentUserRef = doc(db, 'users', currentUser.uid);
    const targetUserRef = doc(db, 'users', targetUserId);

    try {
      if (action === 'sendRequest') {
          await updateDoc(currentUserRef, { friendRequestsSent: arrayUnion(targetUserId) });
          await updateDoc(targetUserRef, { friendRequestsReceived: arrayUnion(currentUser.uid) });
          toast({ title: 'Request Sent', description: 'Your friend request has been sent.' });
      } else if (action === 'acceptRequest') {
          await updateDoc(currentUserRef, { 
              friends: arrayUnion(targetUserId),
              friendRequestsReceived: arrayRemove(targetUserId)
          });
          await updateDoc(targetUserRef, {
              friends: arrayUnion(currentUser.uid),
              friendRequestsSent: arrayRemove(authUser.uid)
          });
          toast({ title: 'Friend Added', description: 'You are now friends!' });
      } else if (action === 'declineRequest') {
          await updateDoc(currentUserRef, { friendRequestsReceived: arrayRemove(targetUserId) });
          await updateDoc(targetUserRef, { friendRequestsSent: arrayRemove(authUser.uid) });
          toast({ title: 'Request Declined' });
      } else if (action === 'removeFriend') {
          await updateDoc(currentUserRef, { friends: arrayRemove(targetUserId) });
          await updateDoc(targetUserRef, { friends: arrayRemove(currentUser.uid) });
          toast({ title: 'Friend Removed' });
      }
    } catch (error: any) {
        console.error("Error with friend action:", error);
        toast({ title: 'Error', description: error.message || "An unexpected error occurred.", variant: "destructive" });
    }
  }, [currentUser, toast, authUser]);

  const handleBlockUser = useCallback(async (targetUserId: string, isBlocked: boolean) => {
    if (!currentUser) return;
    const currentUserRef = doc(db, 'users', currentUser.uid);

    try {
      if (isBlocked) {
        await updateDoc(currentUserRef, { blockedUsers: arrayRemove(targetUserId) });
        toast({ title: 'User Unblocked', description: 'You can now receive messages from this user.' });
      } else {
        await updateDoc(currentUserRef, { blockedUsers: arrayUnion(targetUserId) });
        toast({ title: 'User Blocked', description: 'You will no longer see messages or chats from this user.' });
      }
    } catch (error: any) {
      console.error("Error blocking user:", error);
      toast({ title: 'Error', description: error.message || 'An unexpected error occurred.', variant: 'destructive' });
    }
  }, [currentUser, toast]);
  
  const handleMuteToggle = useCallback(async (conversationId: string) => {
      if (!currentUser) return;
      const userRef = doc(db, 'users', currentUser.uid);
      const isMuted = currentUser.mutedConversations?.includes(conversationId);

      try {
          if (isMuted) {
              await updateDoc(userRef, { mutedConversations: arrayRemove(conversationId) });
              toast({ title: 'Unmuted', description: 'You will now receive notifications from this chat.' });
          } else {
              await updateDoc(userRef, { mutedConversations: arrayUnion(conversationId) });
              toast({ title: 'Muted', description: 'You will no longer receive notifications from this chat.' });
          }
      } catch (error: any) {
          console.error("Error toggling mute:", error);
          toast({ title: 'Error', description: error.message || "Could not update mute setting.", variant: 'destructive'});
      }
  }, [currentUser, toast]);


  const handleCreateStory = useCallback(async (mediaFile: File, caption?: string) => {
    if (!currentUser) return Promise.reject("No current user");
  
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
      toast({ title: "Cloudinary not configured", variant: "destructive" });
      return Promise.reject("Cloudinary not configured");
    }
  
    const tempId = uuidv4();
    const isVideo = mediaFile.type.startsWith('video/');
    const optimisticStory: Story = {
      id: tempId,
      ownerId: currentUser.uid,
      mediaUrl: URL.createObjectURL(mediaFile),
      mediaType: isVideo ? 'video' : 'image',
      caption,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24*60*60*1000),
      viewedBy: [],
      reactions: [],
    };
    setStories(prev => [optimisticStory, ...prev]);
  
    let signal: { xhrAbort?: () => void } = {};
    try {
      const { secure_url, resource_type, duration } = await uploadToCloudinaryXHR(mediaFile, cloudName, uploadPreset, p => {
        // optionally show story upload progress if you want
      }, signal);
      
      const now = Timestamp.now();
      const expiresAt = new Timestamp(now.seconds + 24*60*60, now.nanoseconds);
      const storyData: Omit<Story, 'id'> = {
        ownerId: currentUser.uid,
        mediaUrl: secure_url,
        mediaType: isVideo ? 'video' : 'image',
        caption,
        createdAt: now,
        expiresAt,
        viewedBy: [],
        reactions: [],
      }
      if(isVideo && duration) {
        storyData.duration = duration;
      }

      await addDoc(collection(db, 'stories'), storyData);
      
      toast({ title: "Story posted!" });
    } catch (err) {
      console.error("Error uploading story:", err);
      // remove optimistic story or mark failed
      setStories(prev => prev.filter(s => s.id !== tempId));
      toast({ title: "Error", description: "Failed to post story.", variant: "destructive" });
      return Promise.reject(err);
    }
  }, [currentUser, toast]);


  const handleViewStory = useCallback((user: User, stories: Story[]) => {
      setViewingStory({ user, stories });
  }, []);
  
  const handleStoryMarkAsViewed = useCallback(async (storyId: string) => {
    if(!currentUser) return;
    try {
        await updateDoc(doc(db, 'stories', storyId), {
            viewedBy: arrayUnion(currentUser.uid)
        });
    } catch (error) {
        console.error("Failed to mark story as viewed", error);
    }
  }, [currentUser]);

  const handleDeleteStory = useCallback(async (storyId: string) => {
    try {
        await deleteDoc(doc(db, 'stories', storyId));
        toast({ title: "Story deleted" });
        setViewingStory(null); // Close the viewer
    } catch (error) {
        console.error("Error deleting story:", error);
        toast({ title: "Error", description: "Failed to delete story.", variant: "destructive" });
    }
  }, [toast]);
  
  const handleStoryReaction = useCallback(async (storyId: string, emoji: string) => {
    if (!currentUser) return;
    try {
      const storyRef = doc(db, 'stories', storyId);
      const reaction: StoryReaction = {
        emoji,
        userId: currentUser.uid,
      };
      await updateDoc(storyRef, {
        reactions: arrayUnion(reaction)
      });
    } catch(error) {
       console.error("Failed to add reaction to story", error);
    }
  }, [currentUser]);


  const activeSendMessage = useCallback((messageText: string, replyTo?: Message['replyTo']): Promise<string> => {
    if (!selectedChat || !currentUser) return Promise.reject("No chat selected");
    if (selectedChat.id === AI_USER_ID) {
      handleAiConversation(messageText);
      return Promise.resolve(uuidv4()); // Return a dummy tempId
    } else {
      return handleSendMessage(selectedChat.id, currentUser.uid, messageText, replyTo);
    }
  }, [selectedChat, currentUser, handleAiConversation, handleSendMessage]);

  const activeSendFile = useCallback((file: File, message: string): Promise<string> => {
      if (!selectedChat || !currentUser) return Promise.reject("No chat selected");
      return handleFileUpload(file, message, selectedChat.id, currentUser.uid);
  }, [selectedChat, currentUser, handleFileUpload]);

  const activeSendBase64File = useCallback((base64: string, fileType: string, fileName: string, caption: string) => {
      if (!selectedChat || !currentUser) return Promise.reject("No chat selected");
      return handleSendBase64File(selectedChat.id, currentUser.uid, base64, fileType, fileName, caption);
  }, [selectedChat, currentUser, handleSendBase64File]);

  const handleBack = useCallback(() => {
    setSelectedChat(undefined);
  }, []);

  const handleTyping = useCallback(async (isTyping: boolean) => {
    if (!selectedChat || !currentUser || selectedChat.id === AI_USER_ID) return;

    const chatRef = doc(db, 'conversations', selectedChat.id);
    try {
      if (isTyping) {
        await updateDoc(chatRef, {
          typing: arrayUnion(currentUser.uid)
        });
      } else {
        await updateDoc(chatRef, {
          typing: arrayRemove(currentUser.uid)
        });
      }
    } catch (error) {
      console.error("Error updating typing status:", error);
    }
  }, [selectedChat, currentUser]);
  
  const handleStoryReply = useCallback(async (story: Story, message: string) => {
    if (!currentUser) return;
    const storyOwnerId = story.ownerId;
    const storyOwner = usersCache.get(storyOwnerId);
    if (!storyOwner) return;

    setViewingStory(null); // Close the viewer

    let chatId: string;
    const existingConvo = conversations.find(c => c.type === 'private' && c.participants.includes(storyOwnerId));
    
    if(existingConvo) {
      chatId = existingConvo.id;
      handleChatSelect(existingConvo.id);
    } else {
      chatId = await handleCreateChat(storyOwner);
    }
    
    const replyTo: Message['replyTo'] = {
        storyId: story.id,
        storyMedia: story.mediaUrl,
        messageSender: storyOwner.name,
        messageText: 'Replied to story'
    };
    
    handleSendMessage(chatId, currentUser.uid, message, replyTo);
    
    toast({ title: 'Reply Sent!' });

  }, [currentUser, usersCache, conversations, handleCreateChat, handleSendMessage, toast, handleChatSelect]);

  const usersWithStories = allUsers.filter(u => stories.some(s => s.ownerId === u.uid));
  
  const handleCreateStoryFromFile = (file: File, caption: string) => {
    handleCreateStory(file, caption);
  };

  const handleClearChat = useCallback(async (conversationId: string) => {
    const messagesRef = collection(db, 'conversations', conversationId, 'messages');
    
    try {
      const querySnapshot = await getDocs(messagesRef);
      if (querySnapshot.empty) return;
  
      // Firestore allows a maximum of 500 operations in a single batch.
      const batchSize = 500;
      let batch = writeBatch(db);
      let count = 0;
  
      for (const messageDoc of querySnapshot.docs) {
        batch.delete(messageDoc.ref);
        count++;
        if (count === batchSize) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
  
      if (count > 0) {
        await batch.commit();
      }

      await updateDoc(doc(db, 'conversations', conversationId), {
        lastMessage: null
      });
      
      setMessages([]);

      toast({ title: 'Chat Cleared', description: 'All messages have been deleted.' });

    } catch (error) {
      console.error("Error clearing chat:", error);
      toast({ title: 'Error', description: 'Could not clear chat history.', variant: 'destructive' });
    }
  }, [toast]);


  return {
    conversations,
    selectedChat,
    isAiReplying,
    allUsers,
    usersCache,
    currentUser,
    uploadProgress,
    stories,
    viewingStory,
    setViewingStory,
    usersWithStories,
    previewStoryFile, 
    setPreviewStoryFile,
    aiConversation,
    messages,
    loadMoreMessages,
    hasMoreMessages,
    isLoadingMore,
    handleViewStory,
    handleCreateStory,
    handleStoryMarkAsViewed,
    handleDeleteStory,
    handleStoryReaction,
    handleChatSelect,
    activeSendMessage,
    activeSendFile,
    activeSendBase64File,
    handleMessageAction,
    cancelUpload,
    handleCreateChat,
    handleCreateGroupChat,
    handleBack,
    handleConversationAction,
    handleTyping,
    handleFriendAction,
    handleBlockUser,
    handleCreateStoryFromFile,
    handleStoryReply,
    handleMuteToggle,
    handleClearChat,
  }
}

type AppShellContextType = ReturnType<typeof useChatData>;

const AppShellContext = createContext<AppShellContextType | undefined>(undefined);

export function useAppShell() {
  const context = useContext(AppShellContext);
  if (!context) {
    throw new Error('useAppShell must be used within an AppShell provider');
  }
  return context;
}

function AppBackground() {
  const { appBackground, useCustomBackground } = useAppearance();
  const isMobile = useIsMobile();

  if (!useCustomBackground) {
    return <div className="absolute inset-0 bg-black" />;
  }

  switch(appBackground) {
    case 'galaxy':
      return isMobile ? <MobileGalaxyBackground /> : <GalaxyBackground />;
    case 'glow':
      return <GradientGlowBackground />;
    case 'aura':
      return <AuraBackground />;
    case 'grid':
        return <GridBackground />;
    default:
      return <GalaxyBackground />;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const chatData = useChatData();
  
  return (
    <AppShellContext.Provider value={chatData}>
      <StoriesContext.Provider value={{
        stories: chatData.stories,
        usersWithStories: chatData.usersWithStories,
        currentUser: chatData.currentUser,
        onViewStory: chatData.handleViewStory,
        onCreateStory: chatData.setPreviewStoryFile,
        usersCache: chatData.usersCache,
      }}>
        <div className="relative">
          <AppBackground />
          <div className="relative z-10">
            {children}
          </div>
        </div>

        {chatData.previewStoryFile && (
          <ImagePreviewDialog
            file={chatData.previewStoryFile}
            mode="story"
            onSend={chatData.handleCreateStoryFromFile}
            onCancel={() => chatData.setPreviewStoryFile(null)}
          />
        )}
        
        {chatData.viewingStory && (
            <StoryViewer 
                isOpen={!!chatData.viewingStory}
                onOpenChange={(open) => !open && chatData.setViewingStory(null)}
                user={chatData.viewingStory.user}
                stories={chatData.viewingStory.stories}
                currentUser={chatData.currentUser}
                onMarkAsViewed={chatData.handleStoryMarkAsViewed}
                onDeleteStory={chatData.handleDeleteStory}
                onReply={chatData.handleStoryReply}
                onReact={chatData.handleStoryReaction}
                usersCache={chatData.usersCache}
            />
        )}
      </StoriesContext.Provider>
    </AppShellContext.Provider>
  )
}
