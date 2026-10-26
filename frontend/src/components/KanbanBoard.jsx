import React, { useEffect, useRef, useState } from 'react';
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
  Zap,
  RotateCcw,
  GripVertical,
  ArrowRight,
} from 'lucide-react';
import { api } from '../api';

import FeatureHeader from './FeatureHeader';
import { notify, confirmDialog } from '../context/ToastContext';
import { onDeepLink } from '../lib/deepLink';

export default function KanbanBoard({ workspaceId, tasks, onRefreshTasks, onBack }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all'); // 'all' | 'todo' | 'in_progress' | 'done'

  // Drag and drop state
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverColumnId, setDragOverColumnId] = useState(null);

  // New task form state
  const [taskTitle, setTaskTitle] = useState('');
  const [titleError, setTitleError] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');
  const [taskStatus, setTaskStatus] = useState('todo'); // 'todo' | 'in_progress' | 'done'
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


  // Legacy "review" tasks stay visible under In Progress after the Review column was removed.
  const matchesColumn = (task, colId) => {
    if (colId === 'in_progress') return task.status === 'in_progress' || task.status === 'review';
    return task.status === colId;
  };

  // A notification about a task opens it (once the task list has it).
  const linkedTaskId = useRef(null);
  useEffect(() => onDeepLink('projects', (link) => {
    linkedTaskId.current = link.task_id;
    onRefreshTasks?.();
  }), [onRefreshTasks]);
  useEffect(() => {
    const task = linkedTaskId.current && tasks?.find((t) => t.id === linkedTaskId.current);
    if (task) {
      linkedTaskId.current = null;
      handleOpenTaskDetail(task);
    }
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleOpenTaskDetail = (task) => {
    setSelectedTask(task);
    setEditTitle(task.title);
    setEditDesc(task.description || '');
    setEditPriority(task.priority || 'medium');
    setEditStatus(task.status === 'review' ? 'in_progress' : task.status || 'todo');

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
      notify(`Update error: ${err.message}`, 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!taskTitle.trim()) {
      setTitleError('Give the task a title.');
      return;
    }
    setTitleError('');
    setIsSubmitting(true);
    try {
      await api.createTask(workspaceId, {
        title: taskTitle.trim(),
        description: taskDescription.trim() || undefined,
        priority: taskPriority,
        status: taskStatus || 'todo',
      });
      setShowAddModal(false);
      setTaskTitle('');
      setTaskDescription('');
      setTaskPriority('medium');
      setTaskStatus('todo');
      await onRefreshTasks();
    } catch (err) {
      setTitleError(err.message || 'Could not create the task.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveStatus = async (taskId, newStatus) => {
    try {
      await api.updateTask(workspaceId, taskId, { status: newStatus });
      if (selectedTask && selectedTask.id === taskId) {
        setSelectedTask((prev) => (prev ? { ...prev, status: newStatus } : null));
        setEditStatus(newStatus);
      }
      await onRefreshTasks();
    } catch (err) {
      notify(`Move task error: ${err.message}`, 'error');
    }
  };

  const handleDeleteTask = async (taskId) => {
    if ((await confirmDialog('Delete this task?', { confirmLabel: 'Delete' }))) {
      try {
        await api.deleteTask(workspaceId, taskId);
        if (selectedTask?.id === taskId) setSelectedTask(null);
        await onRefreshTasks();
      } catch (err) {
        notify(err.message, 'error');
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
      urgent: 'bg-rose-500/15 text-rose-500 border-rose-500/30',
      high: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
      medium: 'bg-indigo-500/15 text-indigo-600 border-indigo-500/30',
      low: 'bg-slate-500/15 text-slate-500 border-slate-500/30',
    };
    return (
      <span
        className={`text-xs font-extrabold px-2 py-0.5 rounded-md border ${
          map[priority] || map.medium
        }`}
      >
        {priority || 'medium'}
      </span>
    );
  };

  const getSubtaskStats = (task) => {
    if (!task.description || !task.description.includes('[SUBTASKS]:')) {
      return { total: 0, completed: 0, cleanDesc: task.description || '' };
    }
    try {
      const parts = task.description.split('[SUBTASKS]:');
      const list = JSON.parse(parts[1]) || [];
      return {
        total: list.length,
        completed: list.filter((s) => s.completed).length,
        cleanDesc: parts[0].trim(),
      };
    } catch {
      return { total: 0, completed: 0, cleanDesc: task.description || '' };
    }
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
    <div className="h-full flex flex-col space-y-3.5 text-slate-900 font-sans">
      <FeatureHeader
        title="Sprint Projects & Kanban Board"
        subtitle="Manage sprint tasks, track checklists, and coordinate deliverables across To Do, In Progress, and Done."
        icon={FolderKanban}
        onBack={onBack}
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input aria-label="Search tasks"
                type="text"
                placeholder="Search tasks…"
                className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 shadow-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select aria-label="Filter by priority"
              className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 shadow-sm font-sans"
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
              onClick={() => {
                setTaskStatus(sectionFilter !== 'all' ? sectionFilter : 'todo');
                setShowAddModal(true);
              }}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Task</span>
            </button>
          </div>
        }
      />

      {/* ---------------- TASK BAR SECTION SWITCHER / FILTER ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-xs font-bold text-slate-500 px-2">
            Section:
          </span>
          <button
            onClick={() => setSectionFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              sectionFilter === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>All Columns</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full ${
                sectionFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {filteredTasks.length}
            </span>
          </button>

          <button
            onClick={() => setSectionFilter('todo')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              sectionFilter === 'todo'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'
            }`}
          >
            <span>To Do</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full ${
                sectionFilter === 'todo' ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-700 font-bold'
              }`}
            >
              {filteredTasks.filter((t) => t.status === 'todo').length}
            </span>
          </button>

          <button
            onClick={() => setSectionFilter('in_progress')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              sectionFilter === 'in_progress'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>In Progress</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full ${
                sectionFilter === 'in_progress' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {filteredTasks.filter((t) => t.status === 'in_progress' || t.status === 'review').length}
            </span>
          </button>

          <button
            onClick={() => setSectionFilter('done')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              sectionFilter === 'done'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Done</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full ${
                sectionFilter === 'done' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {filteredTasks.filter((t) => t.status === 'done').length}
            </span>
          </button>
        </div>

        <div className="text-xs text-slate-500 hidden sm:flex items-center gap-1.5 pr-2">
          <span>In <strong>To Do</strong>, shift directly to:</span>
          <span className="font-semibold text-slate-800">
            In Progress
          </span>
          <span>or</span>
          <span className="font-semibold text-slate-800">
            ✓ Done
          </span>
        </div>
      </div>

      {/* ---------------- 3 COLUMNS GRID & DRAG-DROP TARGETS ---------------- */}
      <div
        className={`grid gap-6 flex-1 min-h-0 ${
          sectionFilter === 'all'
            ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
            : 'grid-cols-1 max-w-2xl mx-auto w-full'
        }`}
      >
        {columns
          .filter((col) => sectionFilter === 'all' || sectionFilter === col.id)
          .map((col) => {
            const colTasks = filteredTasks.filter((t) => matchesColumn(t, col.id));
            const isDragOver = dragOverColumnId === col.id;
            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverColumnId !== col.id) setDragOverColumnId(col.id);
                }}
                onDragLeave={() => {
                  if (dragOverColumnId === col.id) setDragOverColumnId(null);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
                  setDraggedTaskId(null);
                  setDragOverColumnId(null);
                  if (taskId) {
                    await handleMoveStatus(taskId, col.id);
                  }
                }}
                className={`p-4 rounded-2xl border flex flex-col h-full shadow-sm transition-[background-color,border-color,box-shadow] duration-150 ${
                  isDragOver
                    ? 'border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-200 shadow-md'
                    : 'border-slate-200 bg-slate-50'
                }`}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-700">
                      {col.label}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 tabular-nums font-bold">
                      {colTasks.length}
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      setTaskStatus(col.id);
                      setShowAddModal(true);
                    }}
                    className="p-1 hover:bg-slate-200 text-slate-500 rounded-lg text-xs flex items-center gap-1 font-bold transition"
                    title={`Add task directly to ${col.label}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="text-xs hidden sm:inline">Add to {col.label}</span>
                  </button>
                </div>

                {/* Task Cards List */}
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {colTasks.map((task) => {
                    const { total: subtaskTotal, completed: subtaskCompleted, cleanDesc } = getSubtaskStats(task);
                    return (
                      <div
                        key={task.id}
                        draggable={true}
                        onDragStart={(e) => {
                          setDraggedTaskId(task.id);
                          e.dataTransfer.setData('text/plain', task.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDraggedTaskId(null);
                          setDragOverColumnId(null);
                        }}
                        onClick={() => handleOpenTaskDetail(task)}
                        className="bg-white border border-slate-200 hover:border-indigo-600 p-3.5 rounded-xl shadow-xs transition space-y-2.5 group cursor-pointer"
                      >
                        {/* Title & Delete button */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-1.5 flex-1 min-w-0">
                            <GripVertical className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 cursor-grab shrink-0 mt-0.5" />
                            <h4 className="font-bold text-xs text-slate-900 leading-snug group-hover:text-indigo-600 transition break-words">
                              {task.title}
                            </h4>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTask(task.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 transition shrink-0"
                            title="Delete task"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {cleanDesc && (
                          <p className="text-xs text-slate-600 leading-relaxed line-clamp-2 pl-5">
                            {cleanDesc}
                          </p>
                        )}

                        {subtaskTotal > 0 && (
                          <div className="flex items-center gap-2 pl-5 text-xs text-slate-500 font-medium">
                            <CheckSquare className="w-3 h-3 text-slate-400" />
                            <span>{subtaskCompleted}/{subtaskTotal} subtasks</span>
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${(subtaskCompleted / subtaskTotal) * 100}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Status Shifter & Priority Bar */}
                        <div
                          className="pt-2.5 border-t border-slate-200 space-y-2 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between">
                            {getPriorityBadge(task.priority)}

                            {/* Direct Quick Dropdown */}
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-slate-400 font-bold">
                                Section:
                              </span>
                              <select aria-label="Task section"
                                value={task.status === 'review' ? 'in_progress' : task.status || 'todo'}
                                onChange={(e) => handleMoveStatus(task.id, e.target.value)}
                                className="text-xs font-bold bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg px-2 py-0.5 text-slate-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                title="Shift section"
                              >
                                <option value="todo">To Do</option>
                                <option value="in_progress">In Progress</option>
                                <option value="done">✅ Done</option>
                              </select>
                            </div>
                          </div>

                          {/* Direct 1-Click Action Shift Buttons */}
                          <div className="flex items-center gap-1.5 pt-0.5">
                            {task.status === 'todo' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleMoveStatus(task.id, 'in_progress')}
                                  className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 border  transition shadow-2xs active:scale-95"
                                  title="Shift task to In Progress section"
                                >
                                  <Zap className="w-3 h-3 text-amber-600 fill-amber-500" />
                                  <span>In Progress</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveStatus(task.id, 'done')}
                                  className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 border  transition shadow-2xs active:scale-95"
                                  title="Shift task directly to Done section"
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  <span>Done</span>
                                </button>
                              </>
                            )}

                            {(task.status === 'in_progress' || task.status === 'review') && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleMoveStatus(task.id, 'todo')}
                                  className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 border  transition shadow-2xs active:scale-95"
                                  title="Shift task back to To Do section"
                                >
                                  <RotateCcw className="w-3 h-3 text-indigo-600" />
                                  <span>To Do</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveStatus(task.id, 'done')}
                                  className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 border  transition shadow-2xs active:scale-95"
                                  title="Shift task to Done section"
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  <span>Done</span>
                                </button>
                              </>
                            )}

                            {task.status === 'done' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleMoveStatus(task.id, 'todo')}
                                  className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 border border-slate-200 transition shadow-2xs active:scale-95"
                                  title="Reopen into To Do section"
                                >
                                  <RotateCcw className="w-3 h-3 text-slate-500" />
                                  <span>To Do</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveStatus(task.id, 'in_progress')}
                                  className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 border  transition shadow-2xs active:scale-95"
                                  title="Move back to In Progress section"
                                >
                                  <Zap className="w-3 h-3 text-amber-600 fill-amber-500" />
                                  <span>In Progress</span>
                                </button>
                              </>
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
          <div data-modal className="p-6 rounded-2xl border border-slate-200 max-w-lg w-full space-y-5 bg-white max-h-[90vh] overflow-y-auto shadow-2xl text-slate-900">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="w-5 h-5 text-indigo-600" />
                <span className="text-xs font-bold text-slate-500 tabular-nums">
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
                <label htmlFor="kanban-board-field-1" className="text-xs font-bold text-slate-700 block mb-1">
                  Title
                </label>
                <input id="kanban-board-field-1"
                  type="text"
                  required
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 font-bold"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 block">
                    Task Section / Status
                  </label>
                  <span className="text-xs text-slate-400 font-medium">Click to shift section</span>
                </div>

                {/* Segmented Status Shifter */}
                <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setEditStatus('todo')}
                    className={`py-2 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      editStatus === 'todo'
                        ? 'bg-white text-indigo-700 shadow-sm border border-indigo-200'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    <span>📋</span>
                    <span>To Do</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditStatus('in_progress')}
                    className={`py-2 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      editStatus === 'in_progress'
                        ? 'bg-white text-amber-800 shadow-sm border border-amber-300'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                    <span>In Progress</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditStatus('done')}
                    className={`py-2 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      editStatus === 'done'
                        ? 'bg-white text-emerald-800 shadow-sm border border-emerald-300'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Done</span>
                  </button>
                </div>

                {/* Priority Selection */}
                <div>
                  <label htmlFor="kanban-board-field-2" className="text-xs font-bold text-slate-700 block mb-1">
                    Priority Level
                  </label>
                  <select id="kanban-board-field-2"
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 font-medium"
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value)}
                  >
                    <option value="low">Low Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="high">High Priority</option>
                    <option value="urgent">Urgent Priority</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="kanban-board-field-3" className="text-xs font-bold text-slate-700 block mb-1">
                  Description
                </label>
                <textarea id="kanban-board-field-3"
                  placeholder="Task specifications, context, criteria…"
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 resize-none h-24"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                />
              </div>

              {/* Subtasks Checklist */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">
                    Checklist & Subtasks ({subtasks.filter((s) => s.completed).length}/{subtasks.length})
                  </label>
                  {subtasks.length > 0 && (
                    <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-[width] rounded-full"
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
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                    >
                      <label className="flex items-center gap-2 cursor-pointer truncate flex-1">
                        <input
                          type="checkbox"
                          checked={st.completed}
                          onChange={() => handleToggleSubtask(st.id)}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span className={`truncate ${st.completed ? 'line-through text-slate-400' : 'text-slate-900'}`}>
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
                  <input aria-label="Add a checklist item"
                    type="text"
                    placeholder="Add a checklist item…"
                    className="flex-1 bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
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
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-200">
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
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-sm flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSavingEdit ? 'Saving…' : 'Save Changes'}</span>
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
          <div data-modal className="bg-white p-6 rounded-2xl border border-slate-200 max-w-md w-full space-y-4 shadow-2xl text-slate-900">
            <h3 className="text-base font-bold text-slate-900">Add New Kanban Task</h3>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label htmlFor="kanban-board-field-4" className="text-xs font-bold text-slate-700 block mb-1">
                  Task Title
                </label>
                <input id="kanban-board-field-4"
                  type="text"
                  aria-invalid={titleError ? 'true' : undefined}
                  aria-describedby={titleError ? 'kanban-title-error' : undefined}
                  autoFocus
                  placeholder="e.g. Integrate WebRTC video conferencing"
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                  value={taskTitle}
                  onChange={(e) => {
                    setTaskTitle(e.target.value);
                    if (titleError) setTitleError('');
                  }}
                />
                {titleError && (
                  <p id="kanban-title-error" role="alert" className="mt-1 text-xs font-semibold text-rose-700">
                    {titleError}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="kanban-board-field-5" className="text-xs font-bold text-slate-700 block mb-1">
                  Description
                </label>
                <textarea id="kanban-board-field-5"
                  placeholder="Details, requirements, or test criteria…"
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 resize-none h-20"
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="kanban-board-field-6" className="text-xs font-bold text-slate-700 block mb-1">
                    Add to Column / Status
                  </label>
                  <select id="kanban-board-field-6"
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 font-bold"
                    value={taskStatus}
                    onChange={(e) => setTaskStatus(e.target.value)}
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">✅ Done</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="kanban-board-field-7" className="text-xs font-bold text-slate-700 block mb-1">
                    Priority
                  </label>
                  <select id="kanban-board-field-7"
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value)}
                  >
                    <option value="low">Low Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="high">High Priority</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
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
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-sm"
                >
                  {isSubmitting ? 'Creating…' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
