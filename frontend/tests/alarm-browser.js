module.exports=async(page,step,failures)=>{
  const skip=page.locator('#onboardOverlay button:has-text("Skip")');
  if(await skip.isVisible())await skip.click();
  await step('save automatic task alarm and rearm after editing due time',async()=>{
    await page.evaluate(()=>{openModal();});
    await page.fill('#taskTitleInput','Automatic alarm regression');
    await page.fill('#taskDueInput','2099-10-11');
    await page.fill('#taskDueTimeInput','13:45');
    await page.check('#taskImportantInput');
    await page.click('#saveTaskBtn');
    const saved=await page.evaluate(()=>loadTasks().find(t=>t.title==='Automatic alarm regression'));
    if(saved.reminder||!saved.reminderUtc||!saved.important)throw new Error('automatic task alarm not persisted');
    const expected=await page.evaluate(()=>new Date('2099-10-11T13:45').toISOString());
    if(saved.reminderUtc!==expected)throw new Error('task UTC does not match Cairo local time');
    await page.evaluate(id=>{const tasks=loadTasks();tasks.find(t=>t.id===id).reminderDismissed=true;saveTasks(tasks);openModal(id);},saved.id);
    await page.fill('#taskDueTimeInput','14:15');
    await page.click('#saveTaskBtn');
    const edited=await page.evaluate(id=>loadTasks().find(t=>t.id===id),saved.id);
    if(edited.reminderDismissed||edited.reminderUtc===saved.reminderUtc)throw new Error('edited alarm not rearmed');
  },failures);
  await step('save automatic timetable alarm with empty reminder',async()=>{
    await page.evaluate(()=>openTimetableBlockModal());
    await page.fill('#ttBlockTitleInput','Automatic timetable regression');
    await page.fill('#ttBlockDateInput','2099-10-11');
    await page.fill('#ttBlockStartInput','09:30');
    await page.fill('#ttBlockEndInput','10:30');
    await page.check('#ttBlockImportantInput');
    await page.click('#timetableBlockModal button:has-text("Save")');
    const result=await page.evaluate(()=>{
      const block=loadTimetableBlocks().find(b=>b.title==='Automatic timetable regression');
      return {block,expected:new Date('2099-10-11T09:30').toISOString()};
    });
    if(result.block.reminder||result.block.reminderUtc!==result.expected)throw new Error('automatic timetable UTC not persisted');
  },failures);
};
