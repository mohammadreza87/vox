// User-specific localStorage key helpers

export const getChatsKey = (userId: string | null) => {
  return userId ? `vox-chats-${userId}` : 'vox-chats-anonymous';
};

export const getCustomContactsKey = (userId: string | null) => {
  return userId ? `vox-customContacts-${userId}` : 'vox-customContacts-anonymous';
};

export const getClonedVoicesKey = (userId: string | null) => {
  return userId ? `vox-clonedVoices-${userId}` : 'vox-clonedVoices-anonymous';
};
