export type ProductPrincipal = {
  id: string;
  name: string;
  kind: 'human' | 'agent' | 'runtime';
  role: string;
  organization_id: string;
  scope_ids: string[];
};

export type ProductSession = {
  token: string;
  principal: ProductPrincipal;
};

export type ProductHealth = {
  status: string;
  product: 'knowledge' | 'code';
  database: 'sqlite' | 'postgresql';
  mode: 'development' | 'production';
};

export type Reference = {
  product: 'work' | 'knowledge' | 'code' | 'external';
  kind: 'task' | 'document_version' | 'pull_request' | 'test_report' | 'url';
  uri: string;
  title: string;
};

export type Space = {
  id: string;
  key: string;
  name: string;
  description: string;
  organization_id: string;
  created_at: string;
};

export type KnowledgeDocument = {
  id: string;
  space_id: string;
  title: string;
  summary: string;
  tags: string[];
  current_version: number;
  created_at: string;
  updated_at: string;
};

export type DocumentHit = KnowledgeDocument & {
  snippet?: string;
  uri?: string;
  version?: number;
};

export type DocumentVersion = {
  id: string;
  document_id: string;
  version: number;
  title: string;
  body: string;
  change_summary: string;
  author_id: string;
  content_sha256: string;
  source_refs: Reference[];
  created_at: string;
  uri: string;
};

export type Decision = {
  id: string;
  space_id: string;
  document_id: string | null;
  title: string;
  body: string;
  source_refs: Reference[];
  actor_id: string;
  created_at: string;
};

export type DocumentContext = {
  document: KnowledgeDocument;
  version: DocumentVersion;
  history: DocumentVersion[];
  decisions: Decision[];
};

export type CodeProject = {
  id: string;
  key: string;
  name: string;
  description: string;
  organization_id: string;
  created_at: string;
};

export type Repository = {
  id: string;
  project_id: string;
  provider: 'gitea';
  owner: string;
  name: string;
  default_branch: string;
  web_url: string;
  clone_url: string;
  created_at: string;
};

export type PullRequest = {
  id: string;
  repository_id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  head: string;
  base: string;
  web_url: string;
  head_sha: string;
  source_refs: Reference[];
  created_at: string;
  updated_at: string;
};

export type CodeCheck = {
  id: string;
  repository_id: string;
  commit_sha: string;
  context: string;
  state: 'pending' | 'success' | 'failure' | 'error';
  description: string;
  target_url: string | null;
  source: 'agent_reported' | 'gitea_webhook';
  actor_id: string;
  created_at: string;
};

export type PullRequestContext = PullRequest & { checks: CodeCheck[] };

export type CodeHealth = ProductHealth & { product: 'code'; gitea_configured: boolean };
