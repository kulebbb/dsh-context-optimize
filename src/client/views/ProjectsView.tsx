/**
 * 项目看板：哪些工作区放了项目级 skill，点行进详情；没有 skill 的工作区收成一行可展开。
 *
 * 数据来自 `.projects`，行内不再单独请求；详情页的完整列表走 ProjectDetail。
 */
import { useState } from 'react'
import type { ProjectEntry, ProjectsPayload, SkillEntry } from '../../shared/types.ts'
import type { Translate } from '../dsh.ts'
import { errorMessage } from '../format.ts'
import { FolderIcon } from '../icons.tsx'
import { SegNav } from './SegNav.tsx'
import type { RangeView } from './SegNav.tsx'
import { StateBlock } from './StateBlock.tsx'

const PROJECT_COLUMNS = 'minmax(0,1fr) 230px 118px'

export interface ProjectsViewProps {
  t: Translate
  payload: ProjectsPayload | null
  loading: boolean
  error: string | null
  canOpen: boolean
  view: RangeView
  onSelectView(view: RangeView): void
  onRetry(): void
  onOpenProject(project: ProjectEntry): void
  onOpenPath(path: string): void
}

interface ProjectRowProps {
  t: Translate
  project: ProjectEntry
  /** 有项目级 skill 且目录仍存在时才可点进详情。 */
  clickable: boolean
  canOpen: boolean
  onOpenProject(project: ProjectEntry): void
  onOpenPath(path: string): void
}

function previewTags(t: Translate, project: ProjectEntry): JSX.Element[] {
  const tags = project.preview.map((skill: SkillEntry) => (
    <span key={skill.dirName} className="dscx-tag dscx-tag-green">
      {skill.name}
    </span>
  ))
  const more = project.skillCount - project.preview.length
  if (more > 0) {
    tags.push(
      <span key="__more" className="dscx-tag dscx-tag-dim">
        {t('projects.moreSkills', { count: more })}
      </span>,
    )
  }
  return tags
}

function ProjectRow(props: ProjectRowProps): JSX.Element {
  const { t, project, clickable, canOpen, onOpenProject, onOpenPath } = props
  const openFolder = (event: { stopPropagation(): void }): void => {
    event.stopPropagation()
    onOpenPath(project.path)
  }
  return (
    <div
      className={clickable ? 'dscx-tr dscx-clickable' : 'dscx-tr'}
      style={{ gridTemplateColumns: PROJECT_COLUMNS }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onOpenProject(project) : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              // 行内还有「打开项目目录」按钮，它的按键不要冒泡成「进详情」。
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpenProject(project)
              }
            }
          : undefined
      }
    >
      <div className="dscx-c-name">
        <div className="t">
          <b>{project.title}</b>
          {project.exists ? null : <span className="dscx-tag dscx-tag-warn">{t('projects.missing')}</span>}
        </div>
        <div className="d">{project.path}</div>
      </div>
      <div className="dscx-ps">
        {project.skillCount > 0 ? previewTags(t, project) : null}
        {project.skillCount > 0 ? <span className="dscx-ps-tokens">{project.approxTokens}t</span> : null}
      </div>
      <div className="dscx-prow-actions">
        {clickable ? (
          <span className="dscx-prow-go">{t('projects.viewSkills')}</span>
        ) : (
          <span className="dscx-num-r dscx-zero">{t('projects.noSkills')}</span>
        )}
        {canOpen ? (
          <div className="dscx-ops">
            <button
              type="button"
              className="dscx-iconbtn"
              title={t('action.openProject')}
              aria-label={t('action.openProject')}
              disabled={!project.exists}
              onClick={openFolder}
            >
              <FolderIcon />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ProjectsView(props: ProjectsViewProps): JSX.Element {
  const { t, payload, loading, error, canOpen, view, onSelectView, onRetry, onOpenProject, onOpenPath } = props
  const [showAll, setShowAll] = useState(false)

  const projects = payload?.projects ?? []
  const withSkills = projects.filter((project) => project.skillCount > 0)
  const rest = projects.filter((project) => project.skillCount === 0)
  const total = payload?.total ?? projects.length

  let body: JSX.Element
  if (loading && payload === null) {
    body = <StateBlock t={t} kind="loading" />
  } else if (error !== null) {
    body = (
      <StateBlock
        t={t}
        kind="error"
        title={t('error.projectsTitle')}
        desc={errorMessage(t, error)}
        onRetry={onRetry}
      />
    )
  } else if (withSkills.length === 0) {
    body = <div className="dscx-empty">{t('projects.empty')}</div>
  } else {
    body = (
      <>
        {withSkills.map((project) => (
          <ProjectRow
            key={project.id}
            t={t}
            project={project}
            clickable={project.exists}
            canOpen={canOpen}
            onOpenProject={onOpenProject}
            onOpenPath={onOpenPath}
          />
        ))}
        {showAll
          ? rest.map((project) => (
              <ProjectRow
                key={project.id}
                t={t}
                project={project}
                clickable={false}
                canOpen={canOpen}
                onOpenProject={onOpenProject}
                onOpenPath={onOpenPath}
              />
            ))
          : null}
      </>
    )
  }

  return (
    <>
      <div className="dscx-ph">
        <div className="dscx-ph-title">
          <h1 className="dscx-h1">{t('projects.title')}</h1>
          <p className="dscx-sub">{t('projects.subtitle', { total, withSkills: withSkills.length })}</p>
        </div>
      </div>
      <SegNav t={t} view={view} onSelect={onSelectView} />
      <div className="dscx-tbl">
        <div className="dscx-thead" style={{ gridTemplateColumns: PROJECT_COLUMNS }}>
          <span>{t('projects.colWorkspace')}</span>
          <span>{t('projects.colSkills')}</span>
          <span />
        </div>
        {body}
      </div>
      {rest.length > 0 && error === null ? (
        <button
          type="button"
          className={showAll ? 'dscx-restline dscx-on' : 'dscx-restline'}
          onClick={() => setShowAll((value) => !value)}
        >
          <span>
            {showAll
              ? t('projects.restExpanded', { count: rest.length })
              : t('projects.rest', { count: rest.length })}
          </span>
          <span className="rn">{showAll ? t('projects.collapse') : t('projects.expand')}</span>
        </button>
      ) : null}
    </>
  )
}
