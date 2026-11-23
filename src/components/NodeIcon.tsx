import { BookOpen, Cpu, GitBranch, Globe, Layers } from 'lucide-react';
import type { NodeIconName } from '../types/mindflow';

interface NodeIconProps {
  name: NodeIconName;
  className?: string;
}

export function NodeIcon({ name, className = 'w-4 h-4' }: NodeIconProps) {
  switch (name) {
    case 'cpu':
      return <Cpu className={className} aria-hidden="true" />;
    case 'book':
      return <BookOpen className={className} aria-hidden="true" />;
    case 'layers':
      return <Layers className={className} aria-hidden="true" />;
    case 'git-branch':
      return <GitBranch className={className} aria-hidden="true" />;
    case 'globe':
      return <Globe className={className} aria-hidden="true" />;
    default:
      return <Cpu className={className} aria-hidden="true" />;
  }
}
