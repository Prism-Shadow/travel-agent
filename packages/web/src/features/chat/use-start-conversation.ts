/** Every explicit start preserves the active draft and states its Trip scope, including none. */
import { useNavigate } from "react-router";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { parkActiveDraft } from "./draft-sessions";

export function useStartConversation() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentProject, agents } = useProject();
  return (tripId: string | null = null, agentId?: string) => {
    if (user && currentProject) parkActiveDraft(user.userId, currentProject.projectId);
    const target =
      agentId ?? (agents.find((a) => a.agentId === "default_agent") ?? agents[0])?.agentId;
    navigate("/chat/new", { state: { tripId, ...(target ? { agentId: target } : {}) } });
  };
}
