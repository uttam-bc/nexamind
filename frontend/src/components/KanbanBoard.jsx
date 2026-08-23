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
import { useToast } from '../context/ToastContext';
import { PageHeader, SearchInput, Modal, Badge, EmptyState } from './ui';

export default function KanbanBoard({ workspaceId, tasks, onRefreshTasks }) {
  const { error: toastError, confirm } = useToast();
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
      toastError(`Update error: ${err.message}`);
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
      toastError(`Create task error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveStatus = async (taskId, newStatus) => {
    try {
      await api.updateTask(workspaceId, taskId, { status: newStatus });
      await onRefreshTasks();
    } catch (err) {
      toastError(`Move task error: ${err.message}`);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (await confirm('Delete this task?')) {
      try {
        await api.deleteTask(workspaceId, taskId);
        if (selectedTask?.id === taskId) setSelectedTask(null);
        await onRefreshTasks();
      } catch (err) {
        toastError(err.message);
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

  const priorityVariant = (priority) => {
    const map = { urgent: 'rose', high: 'amber', medium: 'indigo', low: 'default' };
    return map[priority] || 'indigo';
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
    <div className="h-full flex flex-col space-y-6">
      <PageHeader
        title="Tasks & Kanban"
        description="Manage sprint tasks, track checklists, and coordinate deliverables."
        actions={
          <>
            <SearchInput value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search tasks..." className="w-48" />
            <select className="input-base py-2 text-xs w-auto" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <button onClick={() => setShowAddModal(true)} className="btn-primary py-2 text-xs">
              <Plus className="w-4 h-4" /> Add Task
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6 flex-1 min-h-0">
        {columns.map((col) => {
          const colTasks = filteredTasks.filter((t) => t.status === col.id);
          return (
            <div
              key={col.id}
              className={`glass-panel p-4 rounded-2xl border ${col.color} flex flex-col h-full bg-slate-900/60`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-xs uppercase tracking-wider text-slate-200">
                    {col.label}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono font-bold">
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
                      className="bg-slate-900/90 border border-slate-800 hover:border-indigo-500/50 p-4 rounded-xl shadow-md transition space-y-2.5 group cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-bold text-xs text-slate-100 leading-snug group-hover:text-indigo-300 transition">
                          {task.title}
                        </h4>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTask(task.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 transition"
                          title="Delete task"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {cleanDesc && (
                        <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                          {cleanDesc}
                        </p>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
                        <Badge variant={priorityVariant(task.priority)}>{task.priority || 'medium'}</Badge>

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {col.id !== 'todo' && (
                            <button
                              onClick={() =>
                                handleMoveStatus(task.id, col.id === 'done' ? 'in_progress' : 'todo')
                              }
                              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition"
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
                              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition"
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
                  <EmptyState title={`No tasks in ${col.label}`} description="Add a task to get started" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------------- TASK DETAIL MODAL & DRAWER ---------------- */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-700 max-w-lg w-full space-y-5 bg-slate-900/95 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="w-5 h-5 text-indigo-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Task Details & Checklist
                </span>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTaskDetail} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-bold"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Column Status
                  </label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Priority
                  </label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
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
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Description
                </label>
                <textarea
                  placeholder="Task specifications, context, criteria..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-24"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                />
              </div>

              {/* Subtasks Checklist */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Checklist & Subtasks ({subtasks.filter((s) => s.completed).length}/{subtasks.length})
                  </label>
                  {subtasks.length > 0 && (
                    <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 transition-all rounded-full"
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
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                    >
                      <label className="flex items-center gap-2 cursor-pointer truncate flex-1">
                        <input
                          type="checkbox"
                          checked={st.completed}
                          onChange={() => handleToggleSubtask(st.id)}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600"
                        />
                        <span className={`truncate ${st.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                          {st.text}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveSubtask(st.id)}
                        className="text-slate-500 hover:text-rose-400 p-1"
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
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
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
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => handleDeleteTask(selectedTask.id)}
                  className="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition flex items-center gap-1.5 text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Task</span>
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedTask(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingEdit}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
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
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 max-w-md w-full space-y-4">
            <h3 className="text-base font-bold text-slate-100">Add New Kanban Task</h3>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Task Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Integrate WebRTC video conferencing"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Description
                </label>
                <textarea
                  placeholder="Details, requirements, or test criteria..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-20"
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Priority
                </label>
                <select
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
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
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
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
