import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertCircle,
  FolderKanban,
  CheckCircle2,
  Search,
  Filter,
  CheckSquare,
  Square,
  Edit2,
  Save,
  X,
  Tag,
  Calendar,
} from 'lucide-react';
import { api } from '../api';

export default function KanbanBoard({ workspaceId, tasks, onRefreshTasks }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');

  // New task form state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit task state for selected task modal
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editStatus, setEditStatus] = useState('todo');
  const [subtasks, setSubtasks] = useState([]);
  const [newSubtaskText, setNewSubtaskText] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const columns = [
    { id: 'todo', label: 'To Do', color: 'border-indigo-500/50', badgeColor: 'bg-indigo-500/10 text-indigo-400' },
    { id: 'in_progress', label: 'In Progress', color: 'border-amber-500/50', badgeColor: 'bg-amber-500/10 text-amber-400' },
    { id: 'done', label: 'Done', color: 'border-emerald-500/50', badgeColor: 'bg-emerald-500/10 text-emerald-400' },
  ];

  const handleOpenTaskDetail = (task) => {
    setSelectedTask(task);
    setEditTitle(task.title);
    setEditDesc(task.description || '');
    setEditPriority(task.priority || 'medium');
    setEditStatus(task.status || 'todo');

    // Parse subtasks if stored in description or JSON
    let parsedSubtasks = [];
    if (task.description && task.description.includes('[SUBTASKS]:')) {
      try {
        const parts = task.description.split('[SUBTASKS]:');
        setEditDesc(parts[0].trim());
        parsedSubtasks = JSON.parse(parts[1]);
      } catch {
        parsedSubtasks = [];
      }
    }
    setSubtasks(parsedSubtasks);
  };

  const handleSaveTaskDetail = async (e) => {
    e.preventDefault();
    if (!selectedTask || !editTitle.trim() || isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      let finalDescription = editDesc.trim();
      if (subtasks.length > 0) {
        finalDescription += `\n\n[SUBTASKS]:${JSON.stringify(subtasks)}`;
      }

      await api.updateTask(workspaceId, selectedTask.id, {
        title: editTitle.trim(),
        description: finalDescription || undefined,
        priority: editPriority,
        status: editStatus,
      });

      setSelectedTask(null);
      await onRefreshTasks();
    } catch (err) {
      alert(`Update error: ${err.message}`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!taskTitle.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await api.createTask(workspaceId, {
        title: taskTitle.trim(),
        description: taskDescription.trim() || undefined,
        priority: taskPriority,
        status: 'todo',
      });
      setShowAddModal(false);
      setTaskTitle('');
      setTaskDescription('');
      setTaskPriority('medium');
      await onRefreshTasks();
    } catch (err) {
      alert(`Create task error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveStatus = async (taskId, newStatus) => {
    try {
      await api.updateTask(workspaceId, taskId, { status: newStatus });
      await onRefreshTasks();
    } catch (err) {
      alert(`Move task error: ${err.message}`);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (confirm('Delete this task?')) {
      try {
        await api.deleteTask(workspaceId, taskId);
        if (selectedTask?.id === taskId) setSelectedTask(null);
        await onRefreshTasks();
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const handleAddSubtask = (e) => {
    e.preventDefault();
    if (!newSubtaskText.trim()) return;
    setSubtasks([
      ...subtasks,
      { id: Date.now(), text: newSubtaskText.trim(), completed: false },
    ]);
    setNewSubtaskText('');
  };

  const handleToggleSubtask = (subtaskId) => {
    setSubtasks(
      subtasks.map((st) => (st.id === subtaskId ? { ...st, completed: !st.completed } : st))
    );
  };

  const handleRemoveSubtask = (subtaskId) => {
    setSubtasks(subtasks.filter((st) => st.id !== subtaskId));
  };

  const getPriorityBadge = (priority) => {
    const map = {
      urgent: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      high: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      medium: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
      low: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    };
    return (
      <span
        className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
          map[priority] || map.medium
        }`}
      >
        {priority || 'medium'}
      </span>
    );
  };

  // Filter tasks
  const filteredTasks = (tasks || []).filter((task) => {
    const matchesQuery =
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
    return matchesQuery && matchesPriority;
  });

  return (
    <div className="h-full flex flex-col space-y-6 text-[#191C1E] font-sans">
      {/* Top Header & Search/Filter Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[#191C1E] tracking-tight">
            Sprint Projects & Kanban Board
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage sprint tasks, track checklists, and coordinate deliverables across columns.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Search Box */}
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search tasks..."
              className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-3 py-2 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5] shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Priority Filter */}
          <select
            className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5] shadow-sm font-sans"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Task</span>
          </button>
        </div>
      </div>

      {/* 3 Columns Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 min-h-0">
        {columns.map((col) => {
          const colTasks = filteredTasks.filter((t) => t.status === col.id);
          return (
            <div
              key={col.id}
              className="p-4 rounded-2xl border border-[#E2E8F0] flex flex-col h-full bg-[#F8FAFC] shadow-sm"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-[#E2E8F0]">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-700">
                    {col.label}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#ECEEF0] text-slate-600 font-mono font-bold">
                    {colTasks.length}
                  </span>
                </div>
              </div>

              {/* Task Cards List */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {colTasks.map((task) => {
                  const cleanDesc = task.description?.split('[SUBTASKS]:')[0]?.trim();
                  return (
                    <div
                      key={task.id}
                      onClick={() => handleOpenTaskDetail(task)}
                      className="bg-white border border-[#E2E8F0] hover:border-[#4F46E5] p-4 rounded-xl shadow-sm hover-lift transition space-y-2.5 group cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-bold text-xs text-[#191C1E] leading-snug group-hover:text-[#4F46E5] transition">
                          {task.title}
                        </h4>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTask(task.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 transition"
                          title="Delete task"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {cleanDesc && (
                        <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                          {cleanDesc}
                        </p>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0] text-xs">
                        {getPriorityBadge(task.priority)}

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {col.id !== 'todo' && (
                            <button
                              onClick={() =>
                                handleMoveStatus(task.id, col.id === 'done' ? 'in_progress' : 'todo')
                              }
                              className="p-1 text-slate-400 hover:text-[#191C1E] hover:bg-[#F2F4F6] rounded transition"
                              title="Move back"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {col.id !== 'done' && (
                            <button
                              onClick={() =>
                                handleMoveStatus(task.id, col.id === 'todo' ? 'in_progress' : 'done')
                              }
                              className="p-1 text-slate-400 hover:text-[#191C1E] hover:bg-[#F2F4F6] rounded transition"
                              title="Advance forward"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {colTasks.length === 0 && (
                  <div className="text-center text-slate-400 py-12 text-xs italic">
                    No tasks in {col.label}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------------- TASK DETAIL MODAL & DRAWER ---------------- */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="p-6 rounded-2xl border border-[#E2E8F0] max-w-lg w-full space-y-5 bg-white max-h-[90vh] overflow-y-auto shadow-2xl text-[#191C1E]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="w-5 h-5 text-[#4F46E5]" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 font-mono">
                  Task Details & Checklist
                </span>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTaskDetail} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5] font-bold"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Column Status
                  </label>
                  <select
                    className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5]"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Priority
                  </label>
                  <select
                    className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5]"
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value)}
                  >
                    <option value="low">Low Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="high">High Priority</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Description
                </label>
                <textarea
                  placeholder="Task specifications, context, criteria..."
                  className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5] resize-none h-24"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                />
              </div>

              {/* Subtasks Checklist */}
              <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    Checklist & Subtasks ({subtasks.filter((s) => s.completed).length}/{subtasks.length})
                  </label>
                  {subtasks.length > 0 && (
                    <div className="w-24 h-2 bg-[#ECEEF0] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#10B981] transition-all rounded-full"
                        style={{
                          width: `${(subtasks.filter((s) => s.completed).length / subtasks.length) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {subtasks.map((st) => (
                    <div
                      key={st.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs"
                    >
                      <label className="flex items-center gap-2 cursor-pointer truncate flex-1">
                        <input
                          type="checkbox"
                          checked={st.completed}
                          onChange={() => handleToggleSubtask(st.id)}
                          className="rounded border-[#CBD5E1] text-[#4F46E5]"
                        />
                        <span className={`truncate ${st.completed ? 'line-through text-slate-400' : 'text-[#191C1E]'}`}>
                          {st.text}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveSubtask(st.id)}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add a checklist item..."
                    className="flex-1 bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-3 py-1.5 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5]"
                    value={newSubtaskText}
                    onChange={(e) => setNewSubtaskText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddSubtask(e);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddSubtask}
                    className="px-3 py-1.5 bg-[#ECEEF0] hover:bg-[#E0E3E5] text-slate-700 rounded-xl text-xs font-semibold"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => handleDeleteTask(selectedTask.id)}
                  className="text-xs text-rose-600 hover:underline flex items-center gap-1 font-semibold"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Task</span>
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedTask(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingEdit}
                    className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-5 py-2 rounded-xl text-xs font-bold shadow-sm flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSavingEdit ? 'Saving...' : 'Save Changes'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- CREATE TASK MODAL ---------------- */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] max-w-md w-full space-y-4 shadow-2xl text-[#191C1E]">
            <h3 className="text-base font-bold text-[#191C1E]">Add New Kanban Task</h3>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Task Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Integrate WebRTC video conferencing"
                  className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5]"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Description
                </label>
                <textarea
                  placeholder="Details, requirements, or test criteria..."
                  className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-4 py-2 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5] resize-none h-20"
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Priority
                </label>
                <select
                  className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5]"
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value)}
                >
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-5 py-2 rounded-xl text-xs font-bold shadow-sm"
                >
                  {isSubmitting ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
