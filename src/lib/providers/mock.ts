/**
 * Mock provider: deterministic, offline stand-in for real image/video APIs.
 * Used whenever STUDIO_PROVIDER_MODE !== "live" so the app works end-to-end
 * without any API key and without spending money. Real keys (Seedance etc.)
 * are wired later via env.
 */
import type {
  AIProvider, ImageOptions, ImageResult, MediaType, Model, ProviderConfig,
  TaskStatus, VideoOptions, VideoResult,
} from './types'
import { isAiMock, MOCK_IMAGE_PATH, MOCK_VIDEO_PATH } from '@/lib/mock-ai'

export const MOCK_PROVIDER_NAME = 'mock'
export const MOCK_VIDEO_MODEL = 'mock/video-ugc'
export const MOCK_IMAGE_MODEL = 'mock/image-ugc'

/** True unless the operator explicitly opts in to live providers. */
export function isMockMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.STUDIO_PROVIDER_MODE !== 'live' || isAiMock(env)
}

/** Origin the mock provider puts in its result URLs (this app itself). */
export function mockPublicBaseUrl(): string {
  return baseUrl()
}

function baseUrl(): string {
  return (process.env.STUDIO_PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')).replace(/\/$/, '')
}

function hash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(16)
}

const tasks = new Map<string, VideoResult | ImageResult>()

export class MockProvider implements AIProvider {
  readonly name = MOCK_PROVIDER_NAME
  readonly displayName = 'Mock (offline)'
  constructor(_config?: ProviderConfig) {}

  async generateImage(o: ImageOptions): Promise<ImageResult> {
    const taskId = `mock-img-${hash(o.prompt + (o.seed ?? ''))}`
    const n = Math.max(1, o.count ?? 1)
    const r: ImageResult = {
      taskId, modelId: o.modelId || MOCK_IMAGE_MODEL,
      imageUrls: Array.from({ length: n }, () => `${baseUrl()}${MOCK_IMAGE_PATH}`),
      extra: { mock: true },
    }
    tasks.set(taskId, r)
    return r
  }

  async generateVideo(o: VideoOptions): Promise<VideoResult> {
    const taskId = `mock-vid-${hash(o.prompt + (o.seed ?? '') + (o.duration ?? ''))}`
    const r: VideoResult = {
      taskId, modelId: o.modelId || MOCK_VIDEO_MODEL,
      videoUrls: [`${baseUrl()}${MOCK_VIDEO_PATH}`],
      duration: o.duration ?? 5, processingTime: 0, hasAudio: false,
      extra: { mock: true },
    }
    tasks.set(taskId, r)
    return r
  }

  async submitVideoTask(o: VideoOptions): Promise<{ taskId: string; modelId: string }> {
    const r = await this.generateVideo(o)
    return { taskId: r.taskId, modelId: r.modelId }
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const result = tasks.get(taskId)
    if (!result) return { taskId, status: 'failed', error: 'Unknown mock task' }
    return { taskId, status: 'completed', progress: 100, result }
  }

  async waitForTask(taskId: string): Promise<TaskStatus> {
    return this.getTaskStatus(taskId)
  }

  async listModels(mediaType?: MediaType): Promise<Model[]> {
    const all: Model[] = [
      { id: MOCK_VIDEO_MODEL, name: 'Mock UGC video', mediaType: 'video', provider: this.name, modes: ['text-to-video', 'image-to-video'] },
      { id: MOCK_IMAGE_MODEL, name: 'Mock image', mediaType: 'image', provider: this.name, modes: ['text-to-image', 'image-to-image'] },
    ]
    return mediaType ? all.filter((m) => m.mediaType === mediaType) : all
  }
}
