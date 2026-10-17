'use client';

import { FC, ReactNode } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Card } from '@gitroom/frontend/components/ui/card';
import { PillLink } from '@gitroom/frontend/components/ui/pill.button';

const AutomationEmpty: FC<{ icon: ReactNode; title: string; description: string; steps: string[] }> = ({
  icon,
  title,
  description,
  steps,
}) => {
  const t = useT();
  return (
    <div className="flex-1 flex flex-col gap-[20px]">
      <Card className="items-start">
        <span className="w-[56px] h-[56px] rounded-[18px] bg-accentSoft text-accentText flex items-center justify-center" aria-hidden="true">
          {icon}
        </span>
        <h2 className="m-0 text-[28px] font-[500] tracking-[-0.02em]">{title}</h2>
        <p className="m-0 text-[17px] text-textItemBlur max-w-[720px]">{description}</p>
        <ol className="m-0 ps-[20px] flex flex-col gap-[8px] text-[15px]">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <PillLink href="/editor" variant="primary">
          {t('create_post_in_editor', 'Create a post in the editor')}
        </PillLink>
      </Card>
    </div>
  );
};

export const AgentsComponent: FC = () => {
  const t = useT();
  return (
    <AutomationEmpty
      icon={
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="8" width="14" height="11" rx="3" />
          <path d="M12 4v4M9.5 13h.01M14.5 13h.01" />
        </svg>
      }
      title={t('agents_empty_title', 'No agent running yet')}
      description={t(
        'agents_empty_description',
        'Agents will turn the news radar topics into carousels and posts for each channel, and send them to the approval queue.'
      )}
      steps={[
        t('agents_empty_step_1', 'The radar finds a relevant topic for your niche'),
        t('agents_empty_step_2', 'The agent writes the slides and the caption of each channel'),
        t('agents_empty_step_3', 'You review it in Approvals before it is scheduled'),
      ]}
    />
  );
};

export const RadarComponent: FC = () => {
  const t = useT();
  return (
    <AutomationEmpty
      icon={
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 12l6-6" />
        </svg>
      }
      title={t('radar_empty_title', 'The radar does not follow any source yet')}
      description={t(
        'radar_empty_description',
        'The news radar will follow the sources of your niche and suggest topics with a relevance score. Until then, write the posts in the editor.'
      )}
      steps={[
        t('radar_empty_step_1', 'Choose the sources and themes to follow'),
        t('radar_empty_step_2', 'Each new article gets a relevance score'),
        t('radar_empty_step_3', 'The best topics become drafts for the agents'),
      ]}
    />
  );
};
