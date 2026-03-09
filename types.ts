
export interface GroundingSource {
  title?: string;
  uri?: string;
}

export interface NewsArticle {
  id: string;
  headline: string;
  date: string;
  content: string;
  category: string;
  imageUrl: string;
  sources?: GroundingSource[];
}

export interface MunStory {
  title: string;
  story: string;
}

export enum AppMode {
  LANDING = 'LANDING',
  MUNS = 'MUNS'
}
