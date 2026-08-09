import { useMutation, useQuery, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { developmentEmailTemplateService } from './emailTemplates.dev';
import type {
  CreateEmailTemplateArgs,
  CreateSavedSectionArgs,
  EmailChromeDocument,
  EmailChromeSyncResult,
  EmailSavedSection,
  EmailTemplateCatalog,
  EmailTemplateDraft,
  EmailTemplateListArgs,
  EmailTemplateSummary,
  UpdateEmailChromeArgs,
  UpdateEmailTemplateDraftArgs,
} from '../../../types/emailTemplates';

export interface EmailTemplateService {
  catalog(): Promise<EmailTemplateCatalog>;
  list(args: EmailTemplateListArgs): Promise<EmailTemplateSummary[]>;
  get(id: string): Promise<EmailTemplateDraft>;
  create(args: CreateEmailTemplateArgs): Promise<EmailTemplateDraft>;
  updateDraft(args: UpdateEmailTemplateDraftArgs): Promise<EmailTemplateDraft>;
  duplicate(id: string): Promise<EmailTemplateDraft>;
  archive(id: string): Promise<void>;
  getChrome(): Promise<EmailChromeDocument>;
  updateChrome(args: UpdateEmailChromeArgs): Promise<EmailChromeSyncResult>;
  listSavedSections(): Promise<EmailSavedSection[]>;
  createSavedSection(args: CreateSavedSectionArgs): Promise<EmailSavedSection>;
  deleteSavedSection(id: string): Promise<void>;
}

async function call<T>(path: string, args: object): Promise<T> {
  const response = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!response.success) throw new Error(response.message ?? `Request to ${path} failed.`);
  return response.data;
}

const apiService: EmailTemplateService = {
  catalog: () => call('hr/email-templates/catalog', {}),
  list: args => call('hr/email-templates/list', args),
  get: id => call('hr/email-templates/get', { id }),
  create: args => call('hr/email-templates/create', args),
  updateDraft: args => call('hr/email-templates/draft/update', args),
  duplicate: id => call('hr/email-templates/duplicate', { id }),
  archive: id => call('hr/email-templates/archive', { id }),
  getChrome: () => call('hr/email-templates/chrome/get', {}),
  updateChrome: args => call('hr/email-templates/chrome/update', args),
  listSavedSections: () => call('hr/email-templates/saved-sections/list', {}),
  createSavedSection: args => call('hr/email-templates/saved-sections/create', args),
  deleteSavedSection: id => call('hr/email-templates/saved-sections/delete', { id }),
};

// The development adapter is a deliberate service-boundary implementation for the
// currently missing backend contract. Production never silently falls back to it.
export const emailTemplateService: EmailTemplateService = import.meta.env.DEV
  ? developmentEmailTemplateService
  : apiService;

export function useEmailTemplateCatalog() {
  return useQuery({
    queryKey: ['hr', 'email-templates', 'catalog'],
    queryFn: () => emailTemplateService.catalog(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useEmailTemplates(args: EmailTemplateListArgs) {
  return useQuery({
    queryKey: ['hr', 'email-templates', 'list', args],
    queryFn: () => emailTemplateService.list(args),
    placeholderData: previous => previous,
  });
}

export function useEmailTemplate(id: string | null) {
  return useQuery({
    queryKey: ['hr', 'email-templates', 'detail', id],
    queryFn: () => emailTemplateService.get(id!),
    enabled: Boolean(id),
  });
}

export function useCreateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateEmailTemplateArgs) => emailTemplateService.create(args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr', 'email-templates'] }),
  });
}

export function useUpdateEmailTemplateDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateEmailTemplateDraftArgs) => emailTemplateService.updateDraft(args),
    onSuccess: row => {
      queryClient.setQueryData(['hr', 'email-templates', 'detail', row.id], row);
      void queryClient.invalidateQueries({ queryKey: ['hr', 'email-templates', 'list'] });
    },
  });
}

export function useDuplicateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => emailTemplateService.duplicate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr', 'email-templates'] }),
  });
}

export function useEmailChrome() {
  return useQuery({
    queryKey: ['hr', 'email-templates', 'chrome'],
    queryFn: () => emailTemplateService.getChrome(),
    staleTime: 60 * 1000,
  });
}

export function useUpdateEmailChrome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateEmailChromeArgs) => emailTemplateService.updateChrome(args),
    onSuccess: result => {
      queryClient.setQueryData(['hr', 'email-templates', 'chrome'], result.chrome);
      // Every synced template's document changed on the server side.
      void queryClient.invalidateQueries({ queryKey: ['hr', 'email-templates', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['hr', 'email-templates', 'detail'] });
    },
  });
}

export function useSavedSections() {
  return useQuery({
    queryKey: ['hr', 'email-templates', 'saved-sections'],
    queryFn: () => emailTemplateService.listSavedSections(),
    staleTime: 60 * 1000,
  });
}

export function useCreateSavedSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateSavedSectionArgs) => emailTemplateService.createSavedSection(args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr', 'email-templates', 'saved-sections'] }),
  });
}

export function useDeleteSavedSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => emailTemplateService.deleteSavedSection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr', 'email-templates', 'saved-sections'] }),
  });
}

export function useArchiveEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => emailTemplateService.archive(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr', 'email-templates'] }),
  });
}
