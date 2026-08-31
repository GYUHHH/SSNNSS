import { t } from './i18n'

export const customJobProgress = (job: { stage: string; round: number }): number =>
  job.stage === 'draft' ? job.round === 0 ? 8 : Math.min(68, 18 + job.round * 3) : job.stage === 'verify' ? job.round === 0 ? 78 : 92 : 100

export const customJobLabel = (job: { stage: string; round: number; name?: string; error?: string }): string =>
  job.stage === 'draft' ? t(job.round === 0 ? '생성 요청 중' : '3D 모델 생성 중') : job.stage === 'verify' ? t(job.round === 0 ? '모델 최적화 중' : '보관함에 저장 중') : job.stage === 'done' ? `${job.name ?? ''} ${t('완성')}` : t('생성 실패')
