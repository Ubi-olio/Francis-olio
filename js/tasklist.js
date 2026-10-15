document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('input[type="checkbox"]').forEach(function (box, i) {
    box.removeAttribute('disabled')
    var key = 'task-' + location.pathname + '-' + i
    box.checked = localStorage.getItem(key) === 'true'
    box.addEventListener('change', function () {
      localStorage.setItem(key, box.checked)
    })
  })
})
