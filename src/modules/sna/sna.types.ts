export interface TwitterUserItem {
  id: string;
  userName: string;
  followersCount: number;
  description?: string;
  profilePicUrl?: string;
}

export interface TwitterTweetItem {
  id: string;
  text: string;
  createdAt: string;
  author: TwitterUserItem;
  isRetweet?: boolean;
  isQuote?: boolean;
  retweetedStatus?: {
    id: string;
    text: string;
    author: TwitterUserItem;
  };
  quotedStatus?: {
    id: string;
    text: string;
    author: TwitterUserItem;
  };
  inReplyToStatusId?: string;
  inReplyToUserId?: string;
  inReplyToUserName?: string;
  entities?: {
    user_mentions?: Array<{ screen_name: string; id_str: string }>;
  };
}

export interface GraphNode {
  id: string;
  label: string;
  size: number;
  cluster?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface SnaAnalysisResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  analytics: {
    topInfluencers: Array<{ username: string; score: number }>;
    mainClusters: number;
    sentimentSummary?: string;
  };
}
