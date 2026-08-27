export interface SocialPost {
  caption: string;
  imageUrl?: string;
  channels: string[];
}

export interface SocialAdapter {
  publishPost(post: SocialPost): Promise<void>;
}

export class NotImplementedSocialAdapter implements SocialAdapter {
  async publishPost(_post: SocialPost): Promise<void> {
    throw new Error("SocialAdapter not implemented. Wire a concrete adapter.");
  }
}
