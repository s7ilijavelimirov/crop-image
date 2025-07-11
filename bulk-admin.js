jQuery(document).ready(function ($) {
    let selectedImages = [];
    let selectedProducts = [];
    let currentCategory = '';
    let currentPage = 1;
    let totalPages = 1;
    let perPage = 50;
    let isProcessing = false;
    let croppedImages = [];
    let currentSearchTerm = '';
    // Initialize
    init();

    function init() {
        loadCategories();
        setupEventHandlers();
        setupHeartbeat();
    }

    function setupHeartbeat() {
        // Keep connection alive during long operations
        wp.heartbeat.enqueue('bulk_cropper_heartbeat', true, true);

        $(document).on('heartbeat-send', function (e, data) {
            if (isProcessing) {
                data.bulk_cropper_heartbeat = true;
            }
        });

        $(document).on('heartbeat-tick', function (e, data) {
            if (data.bulk_cropper_heartbeat && data.bulk_cropper_heartbeat === 'alive') {
                console.log('Heartbeat: Connection alive');
            }
        });
    }

    function setupEventHandlers() {
        // Category selection
        $('#category-select').on('change', function () {
            currentCategory = $(this).val();
            $('#load-category-products').prop('disabled', !currentCategory);
            updateCategoryInfo();
        });

        $('#load-category-products').on('click', function () {
            currentPage = 1;
            loadCategoryProducts();
        });

        // Reset plugin
        $('#reset-plugin').on('click', function () {
            if (confirm('Reset all data and start fresh? This will clear all selections and results.')) {
                resetPluginState();
            }
        });

        // Pagination
        $('#prev-page').on('click', function () {
            console.log('Prev clicked - currentPage:', currentPage, 'isProcessing:', isProcessing);
            if (currentPage > 1 && !isProcessing) {
                currentPage--;
                loadCategoryProducts();
            }
        });

        $('#next-page').on('click', function () {
            console.log('Next clicked - currentPage:', currentPage, 'totalPages:', totalPages, 'isProcessing:', isProcessing);
            if (currentPage < totalPages && !isProcessing) {
                currentPage++;
                loadCategoryProducts();
            }
        });

        $('#per-page-select').on('change', function () {
            if (!isProcessing) {
                perPage = parseInt($(this).val());
                currentPage = 1;
                loadCategoryProducts();
            }
        });

        // Product selection
        $(document).on('change', '.product-checkbox', function () {
            let productId = parseInt($(this).val());
            let productCard = $(this).closest('.product-card');

            if ($(this).is(':checked')) {
                if (selectedProducts.indexOf(productId) === -1) {
                    selectedProducts.push(productId);
                    productCard.addClass('selected');
                }
            } else {
                selectedProducts = selectedProducts.filter(id => id !== productId);
                productCard.removeClass('selected');
            }
            updateSelectedProductsDisplay();
        });

        // Load images
        $('#load-all-selected-images').on('click', function () {
            if (selectedProducts.length === 0) {
                showNotification('❌ Please select products first', 'error');
                return;
            }

            if (selectedProducts.length > 20) {
                if (!confirm('You selected ' + selectedProducts.length + ' products. This might take a while. Continue?')) {
                    return;
                }
            }

            loadSelectedProductsImages();
        });

        $('#clear-selection').on('click', function () {
            clearAllSelections();
        });

        // Image selection
        $(document).on('change', '.image-checkbox', function () {
            let imageId = parseInt($(this).val());

            if ($(this).is(':checked')) {
                if (selectedImages.indexOf(imageId) === -1) {
                    selectedImages.push(imageId);
                }
            } else {
                selectedImages = selectedImages.filter(id => id !== imageId);
            }
            updateSelectedImagesDisplay();
            updatePaddingControls(); // DODANO
        });

        $('#select-all-images').on('click', function () {
            $('.image-checkbox').prop('checked', true).trigger('change');
        });

        $('#deselect-all-images').on('click', function () {
            $('.image-checkbox').prop('checked', false).trigger('change');
        });

        // Standard cropping (5px)
        $(document).on('click', '.crop-single', function () {
            if (isProcessing) {
                showNotification('⚠️ Please wait for current operation to complete', 'warning');
                return;
            }

            let imageId = $(this).data('image-id');
            cropSingleImage(imageId, $(this));
        });

        $('#crop-selected').on('click', function () {
            if (isProcessing) {
                showNotification('⚠️ Please wait for current operation to complete', 'warning');
                return;
            }

            if (selectedImages.length === 0) {
                showNotification('❌ Please select images to crop', 'error');
                return;
            }

            if (selectedImages.length > 50) {
                showNotification('❌ Maximum 50 images per batch. Please select fewer images.', 'error');
                return;
            }

            if (!confirm('Crop ' + selectedImages.length + ' selected MAIN images with 5px padding? This will modify the original files and cannot be undone.')) {
                return;
            }

            startBulkCrop();
        });

        // Enhanced cropping with custom padding
        $('#crop-with-padding').on('click', function () {
            if (isProcessing) {
                showNotification('⚠️ Please wait for current operation to complete', 'warning');
                return;
            }

            if (selectedImages.length === 0) {
                showNotification('❌ Please select images to crop', 'error');
                return;
            }

            if (selectedImages.length > 20) {
                showNotification('❌ Maximum 20 images per batch for padding crop.', 'error');
                return;
            }

            let padding = parseInt($('#padding-input').val()) || 10;
            if (padding < 0 || padding > 100) {
                showNotification('❌ Padding must be between 0-100px', 'error');
                return;
            }

            if (!confirm('Crop ' + selectedImages.length + ' images with ' + padding + 'px padding? This will modify the original files.')) {
                return;
            }

            startBulkCropWithPadding(padding);
        });

        // Restore individual images
        $(document).on('click', '.restore-backup', function () {
            if (isProcessing) {
                showNotification('⚠️ Please wait for current operation to complete', 'warning');
                return;
            }

            let imageId = $(this).data('image-id');
            if (!confirm('Restore image ' + imageId + ' from backup? This will replace current cropped version.')) {
                return;
            }

            restoreImageFromBackup(imageId, $(this));
        });

        // Toggle detailed log
        $('#toggle-detailed-log').on('click', function () {
            $('#progress-log').toggle();
        });
    }

    function resetPluginState() {
        // Stop svi timeout-ovi
        clearTimeout(window.searchTimeout);

        // Reset varijabli
        selectedImages = [];
        selectedProducts = [];
        currentCategory = '';
        currentSearchTerm = ''; // Dodano
        currentPage = 1;
        totalPages = 1;
        isProcessing = false; // VAŽNO
        croppedImages = [];

        // Clear UI
        $('#category-select').val('');
        $('#search-products').val(''); // Dodano
        $('#clear-search').hide(); // Dodano
        $('#load-category-products').prop('disabled', true);
        $('#category-info').html('');
        $('#products-grid').html('');
        $('#images-grid').html('');
        $('#selected-products-preview').html('');
        $('#cropped-images-grid').html('');
        $('.selected-summary').hide();
        $('#detailed-progress-section').hide();
        $('#cropped-images-section').hide();
        $('#live-progress').hide();
        $('#quick-results').hide();

        // Reset counters
        $('#product-count').text('');
        $('#page-info').text('Page 1 of 1');
        $('#selected-products-count').text('0 selected');
        $('#selected-count').text('0 selected');

        // Reset buttons
        updateSelectedProductsDisplay();
        updateSelectedImagesDisplay();
        updatePaginationButtons(); // Ovo će sada raditi jer je isProcessing = false

        showNotification('✅ Plugin reset successfully', 'success');
    }

    function updateCategoryInfo() {
        if (currentCategory) {
            let categoryName = $('#category-select option:selected').text();
            $('#category-info').html('<p>Selected: <strong>' + categoryName + '</strong> (main images only)</p>');
        } else {
            $('#category-info').html('');
        }
    }

    function loadCategories() {
        $('#category-select').html('<option value="">Loading categories...</option>');

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 30000,
            data: {
                action: 'get_product_categories',
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    displayCategories(response.data);
                } else {
                    $('#category-select').html('<option value="">Failed to load categories</option>');
                    showNotification('❌ Failed to load categories', 'error');
                }
            },
            error: function (xhr, status, error) {
                $('#category-select').html('<option value="">Error loading categories</option>');
                showNotification('❌ Error loading categories: ' + error, 'error');
            }
        });
    }

    function displayCategories(categories) {
        let html = '<option value="">Select a category...</option>';

        categories.forEach(function (category) {
            let countText = category.id === 'all' ? '' : ' (' + category.count + ')';
            html += '<option value="' + category.id + '">' + category.name + countText + '</option>';
        });

        $('#category-select').html(html);
    }

    function loadCategoryProducts() {
        if (!currentCategory && !currentSearchTerm) return;

        isProcessing = true;

        // Search loading indikator
        if (currentSearchTerm) {
            updateLiveProgress(0, 100, 'Pretražujem "' + currentSearchTerm + '"...');
            $('#search-products').css('background', 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' viewBox=\'0 0 20 20\'%3E%3Cpath fill=\'%23999\' d=\'M10 3.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM2 10a8 8 0 1116 0 8 8 0 01-16 0z\' opacity=\'.4\'/%3E%3Cpath fill=\'%23999\' d=\'M10 3.5a6.5 6.5 0 011.5.18V2.27A8.02 8.02 0 0010 2a8 8 0 00-1.5.27v1.41A6.48 6.48 0 0110 3.5z\'%3E%3CanimateTransform attributeName=\'transform\' type=\'rotate\' from=\'0 10 10\' to=\'360 10 10\' dur=\'1s\' repeatCount=\'indefinite\'/%3E%3C/path%3E%3C/svg%3E") no-repeat right 10px center');
        } else {
            updateLiveProgress(0, 100, 'Loading products...');
        }

        $('#live-progress').show();
        $('#products-grid').html('<div class="loading">Loading products...</div>');

        let ajaxData = {
            action: 'get_products_by_category',
            category_id: currentCategory,
            page: currentPage,
            per_page: perPage,
            nonce: ajax_object.nonce
        };

        if (currentSearchTerm) {
            ajaxData.search_term = currentSearchTerm;
        }

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 60000,
            data: ajaxData,
            success: function (response) {
                if (response.success) {
                    displayProducts(response.data.products);
                    updatePagination(response.data.pagination);

                    if (currentSearchTerm) {
                        updateLiveProgress(100, 100, 'Pronađeno ' + response.data.pagination.total_products + ' proizvoda za "' + currentSearchTerm + '"');
                        // Ukloni loading spinner
                        $('#search-products').css('background', 'none');
                    } else {
                        updateLiveProgress(100, 100, 'Products loaded successfully');
                    }

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    $('#products-grid').html('<div class="error">Failed to load products</div>');
                    showNotification('❌ Failed to load products', 'error');
                    totalPages = 1;
                    currentPage = 1;
                    $('#search-products').css('background', 'none');
                }
            },
            error: function (xhr, status, error) {
                $('#products-grid').html('<div class="error">Error loading products: ' + error + '</div>');
                showNotification('❌ Error loading products: ' + error, 'error');
                totalPages = 1;
                currentPage = 1;
                $('#search-products').css('background', 'none');
            },
            complete: function () {
                isProcessing = false;
                updatePaginationButtons();
            }
        });
    }
    function displayProducts(products) {
        if (products.length === 0) {
            let message = currentSearchTerm ?
                'Nema proizvoda sa glavnim slikama za pretragu "' + currentSearchTerm + '"' :
                'No products with main images found in this category.';
            $('#products-grid').html('<div class="no-products">' + message + '</div>');
            return;
        }

        let html = '<div class="products-container">';

        // Search rezultati header
        if (currentSearchTerm) {
            html += '<div class="search-results-header" style="background: #f0f6fc; padding: 10px; margin-bottom: 15px; border-left: 4px solid #0073aa;">';
            html += '<strong>Rezultati pretrage:</strong> "' + currentSearchTerm + '" (' + products.length + ' proizvoda)';
            html += '</div>';
        }

        products.forEach(function (product) {
            let isSelected = selectedProducts.indexOf(product.id) !== -1;
            let checkedAttr = isSelected ? 'checked' : '';
            let selectedClass = isSelected ? 'selected' : '';

            // Highlight search term u nazivu
            let highlightedTitle = product.title;
            if (currentSearchTerm) {
                let regex = new RegExp('(' + currentSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
                highlightedTitle = product.title.replace(regex, '<mark style="background: #ffeb3b; padding: 1px 2px;">$1</mark>');
            }

            html += '<div class="product-card ' + selectedClass + '" data-product-id="' + product.id + '">';
            html += '<div class="product-checkbox-container">';
            html += '<input type="checkbox" class="product-checkbox" value="' + product.id + '" ' + checkedAttr + '>';
            html += '</div>';
            html += '<div class="product-thumbnail">';
            if (product.thumbnail_url) {
                html += '<img src="' + product.thumbnail_url + '" alt="Product thumbnail">';
            } else {
                html += '<div class="no-image">No Image</div>';
            }
            html += '</div>';
            html += '<div class="product-info">';
            html += '<h3 title="' + product.title + '">' + highlightedTitle + '</h3>';
            html += '<div class="product-meta">ID: ' + product.id + ' | ' + product.type_label + ' | ' + product.image_count + ' main images</div>';
            if (product.price) {
                html += '<div class="product-price">' + product.price + '</div>';
            }
            html += '</div>';
            html += '</div>';
        });

        html += '</div>';
        $('#products-grid').html(html);
    }

    function updatePagination(pagination) {
        totalPages = pagination.total_pages;
        currentPage = pagination.current_page;

        let pageInfo = 'Page ' + currentPage + ' of ' + totalPages;
        $('#page-info').text(pageInfo);
        $('#product-count').text('(' + pagination.showing + ' of ' + pagination.total_products + ')');

        // Ne pozivaj updatePaginationButtons() ovde jer je isProcessing još true
        // updatePaginationButtons(); // <-- UKLONI
    }

    function updatePaginationButtons() {
        let prevDisabled = currentPage <= 1 || isProcessing;
        let nextDisabled = currentPage >= totalPages || isProcessing;

        $('#prev-page').prop('disabled', prevDisabled);
        $('#next-page').prop('disabled', nextDisabled);

        // DEBUG sa više info
        console.log('=== PAGINATION DEBUG ===');
        console.log('currentPage:', currentPage);
        console.log('totalPages:', totalPages);
        console.log('isProcessing:', isProcessing);
        console.log('prevDisabled:', prevDisabled);
        console.log('nextDisabled:', nextDisabled);
        console.log('========================');
    }

    function updateSelectedProductsDisplay() {
        let count = selectedProducts.length;
        $('#selected-products-count').text(count + ' products selected');
        $('#load-all-selected-images').prop('disabled', count === 0);
        $('#clear-selection').prop('disabled', count === 0);

        if (count > 0) {
            $('.selected-summary').show();
            displaySelectedProductsPreview();
        } else {
            $('.selected-summary').hide();
        }
    }

    function displaySelectedProductsPreview() {
        let html = '';

        selectedProducts.slice(0, 10).forEach(function (productId) {
            let productCard = $('.product-card[data-product-id="' + productId + '"]');
            if (productCard.length) {
                let productTitle = productCard.find('h3').attr('title') || productCard.find('h3').text();
                let imageCount = productCard.find('.product-meta').text().match(/(\d+) main images/);
                let count = imageCount ? imageCount[1] : '0';

                html += '<span class="selected-product-tag" title="' + productTitle + '">' +
                    productTitle.substring(0, 20) + (productTitle.length > 20 ? '...' : '') +
                    ' (' + count + ')</span>';
            }
        });

        if (selectedProducts.length > 10) {
            html += '<span class="selected-product-tag">+' + (selectedProducts.length - 10) + ' more...</span>';
        }

        $('#selected-products-preview').html(html);
    }

    function clearAllSelections() {
        selectedProducts = [];
        selectedImages = [];
        $('.product-checkbox').prop('checked', false);
        $('.product-card').removeClass('selected');
        $('.image-checkbox').prop('checked', false);
        $('#images-grid').html('');
        $('.selected-summary').hide();
        updateSelectedProductsDisplay();
        updateSelectedImagesDisplay();
        updatePaddingControls();

        showNotification('✅ All selections cleared', 'success');
    }

    function loadSelectedProductsImages() {
        if (selectedProducts.length === 0) return;

        isProcessing = true;
        updateLiveProgress(0, 100, 'Loading main images...');
        $('#live-progress').show();

        $('#images-grid').html('<div class="loading">Loading main images for ' + selectedProducts.length + ' products...</div>');
        selectedImages = [];
        updateSelectedImagesDisplay();

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 120000,
            data: {
                action: 'get_product_images',
                product_ids: selectedProducts,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    displayImages(response.data.images, response.data);
                    updateLiveProgress(100, 100, 'Main images loaded successfully');

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    $('#images-grid').html('<div class="error">Failed to load images</div>');
                    showNotification('❌ Failed to load images', 'error');
                }
            },
            error: function (xhr, status, error) {
                $('#images-grid').html('<div class="error">Error loading images: ' + error + '</div>');
                showNotification('❌ Error loading images: ' + error, 'error');
            },
            complete: function () {
                isProcessing = false;
            }
        });
    }

    function displayImages(images, data) {
        if (images.length === 0) {
            $('#images-grid').html('<div class="no-images">No main images found for selected products.</div>');
            return;
        }

        let html = '<div class="images-info">';
        html += '<strong>Total Main Images:</strong> ' + data.total_images + ' from ' + data.products_count + ' products (main + variations only)';
        html += '</div>';

        // Group images by product
        let imagesByProduct = {};
        images.forEach(function (image) {
            if (!imagesByProduct[image.product_id]) {
                imagesByProduct[image.product_id] = [];
            }
            imagesByProduct[image.product_id].push(image);
        });

        Object.keys(imagesByProduct).forEach(function (productId) {
            let productImages = imagesByProduct[productId];
            let productName = productImages[0].product_name;

            html += '<div class="product-images-group">';
            html += '<div class="product-group-title">' + productName + ' (' + productImages.length + ' main images)</div>';
            html += '<div class="product-images-grid">';

            productImages.forEach(function (image) {
                html += '<div class="image-item" data-image-id="' + image.id + '">';
                html += '<div class="image-checkbox-container">';
                html += '<input type="checkbox" class="image-checkbox" id="img_' + image.id + '" value="' + image.id + '">';
                html += '<label for="img_' + image.id + '">Select</label>';
                html += '</div>';
                html += '<div class="image-preview">';
                html += '<img src="' + image.url + '" alt="' + image.title + '" loading="lazy">';
                if (image.badge) {
                    html += '<div class="image-badge ' + image.badge.toLowerCase() + '">' + image.badge + '</div>';
                }
                html += '</div>';
                html += '<div class="image-info">';
                html += '<div class="image-title" title="' + image.title + '">' + image.title + '</div>';
                html += '<p><strong>ID:</strong> ' + image.id + '</p>';
                html += '<p><strong>Size:</strong> ' + image.size + '</p>';
                html += '<div class="image-actions">';
                html += '<button class="button button-small crop-single" data-image-id="' + image.id + '">Crop</button>';
                html += '<a href="' + image.full_url + '" target="_blank" class="button button-small">View</a>';
                html += '</div>';
                html += '</div>';
                html += '</div>';
            });

            html += '</div>';
            html += '</div>';
        });

        $('#images-grid').html(html);
    }

    function updateSelectedImagesDisplay() {
        let count = selectedImages.length;
        $('#selected-count').text(count + ' selected');
        $('#crop-selected').prop('disabled', count === 0 || isProcessing);
        $('#crop-with-padding').prop('disabled', count === 0 || isProcessing); // DODANO
    }

    function updatePaddingControls() {
        let count = selectedImages.length;
        $('#crop-with-padding').prop('disabled', count === 0 || isProcessing);

        // Load backup status for selected images
        if (count > 0) {
            loadBackupStatus(selectedImages);
        }
    }

    function loadBackupStatus(imageIds) {
        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            data: {
                action: 'get_backup_status',
                image_ids: imageIds,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    updateBackupButtons(response.data);
                }
            }
        });
    }

    function updateBackupButtons(backupStatus) {
        Object.keys(backupStatus).forEach(function (imageId) {
            let imageItem = $('.image-item[data-image-id="' + imageId + '"]');
            let actionsDiv = imageItem.find('.image-actions');

            // Remove existing restore button
            actionsDiv.find('.restore-backup').remove();

            if (backupStatus[imageId].has_backup) {
                let backupDate = new Date(backupStatus[imageId].backup_date).toLocaleDateString();
                actionsDiv.append(
                    '<button class="button button-small restore-backup" data-image-id="' + imageId + '" ' +
                    'title="Backup from ' + backupDate + '">🔄 Restore</button>'
                );
            }
        });
    }

    function updateLiveProgress(current, total, message) {
        let percentage = total > 0 ? (current / total) * 100 : 0;
        $('#mini-progress-fill').css('width', percentage + '%');
        $('#mini-progress-text').text(message);
    }

    function updateDetailedProgress(current, total, message) {
        let percentage = total > 0 ? (current / total) * 100 : 0;
        $('#progress-fill').css('width', percentage + '%');
        $('#progress-text').text(current + ' / ' + total + ' - ' + message);
    }

    function logProgress(message, isError = false) {
        let timestamp = new Date().toLocaleTimeString();
        let currentLog = $('#progress-log').html();
        let logClass = isError ? 'style="color: #d63638;"' : '';
        $('#progress-log').html('[' + timestamp + '] <span ' + logClass + '>' + message + '</span><br>' + currentLog);
    }

    function cropSingleImage(imageId, button) {
        isProcessing = true;
        button.prop('disabled', true).text('Cropping...');

        updateLiveProgress(0, 100, 'Cropping main image ' + imageId + '...');
        $('#live-progress').show();

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 60000,
            data: {
                action: 'crop_single_image',
                image_id: imageId,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    button.text('✓ Cropped').addClass('cropped');
                    updateLiveProgress(100, 100, 'Main image cropped successfully');
                    showQuickResult('✅ Main image ' + imageId + ' cropped successfully');
                    refreshImagePreview(imageId);

                    // Add to cropped images display
                    addCroppedImageToResults(response.data);

                    // Update backup status
                    loadBackupStatus([imageId]);

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    button.text('❌ Failed').addClass('failed');
                    updateLiveProgress(100, 100, 'Crop failed');
                    showQuickResult('❌ Main image ' + imageId + ' failed: ' + (response.data?.message || 'Unknown error'), true);
                }
            },
            error: function (xhr, status, error) {
                button.text('❌ Error').addClass('failed');
                updateLiveProgress(100, 100, 'Error occurred');
                showQuickResult('❌ Main image ' + imageId + ' error: ' + error, true);
            },
            complete: function () {
                isProcessing = false;
                setTimeout(function () {
                    button.prop('disabled', false);
                    if (!button.hasClass('cropped') && !button.hasClass('failed')) {
                        button.text('Crop');
                    }
                }, 3000);
            }
        });
    }

    function startBulkCrop() {
        isProcessing = true;
        $('#detailed-progress-section').show();
        $('#crop-selected').prop('disabled', true).text('🔄 Cropping...');

        // Scroll to progress section smoothly
        $('html, body').animate({
            scrollTop: $('#detailed-progress-section').offset().top - 100
        }, 800);

        updateLiveProgress(0, 100, 'Starting bulk crop of main images...');
        $('#live-progress').show();

        let total = selectedImages.length;
        let completed = 0;
        let results = [];
        let successCount = 0;
        let errorCount = 0;

        function processNext() {
            if (completed >= total) {
                completeBulkCrop(results, successCount, errorCount);
                return;
            }

            let imageId = selectedImages[completed];
            let progress = completed + 1;

            updateDetailedProgress(progress, total, 'Cropping main image ID: ' + imageId);
            updateLiveProgress(progress, total, 'Processing ' + progress + '/' + total);
            logProgress('🔄 Processing main image ' + imageId + ' (' + progress + '/' + total + ')');

            $.ajax({
                url: ajax_object.ajax_url,
                type: 'POST',
                timeout: 60000,
                data: {
                    action: 'crop_single_image',
                    image_id: imageId,
                    nonce: ajax_object.nonce
                },
                success: function (response) {
                    if (response.success) {
                        successCount++;
                        refreshImagePreview(imageId);
                        logProgress('✅ Main image ' + imageId + ' cropped successfully');
                        results.push({ ...response.data, success: true });

                        // Add to cropped images display
                        addCroppedImageToResults(response.data);
                    } else {
                        errorCount++;
                        logProgress('❌ Main image ' + imageId + ' failed: ' + (response.data?.message || 'Unknown error'), true);
                        results.push({ ...response.data, success: false });
                    }
                },
                error: function (xhr, status, error) {
                    errorCount++;
                    logProgress('❌ Main image ' + imageId + ' error: ' + error, true);
                    results.push({ success: false, image_id: imageId, message: 'AJAX error: ' + error });
                },
                complete: function () {
                    completed++;
                    // Delay between requests to prevent server overload
                    setTimeout(processNext, 500);
                }
            });
        }

        processNext();
    }

    function startBulkCropWithPadding(padding) {
        isProcessing = true;
        $('#detailed-progress-section').show();
        $('#crop-with-padding').prop('disabled', true).text('🔄 Cropping with ' + padding + 'px...');

        // Scroll to progress section smoothly
        $('html, body').animate({
            scrollTop: $('#detailed-progress-section').offset().top - 100
        }, 800);

        updateLiveProgress(0, 100, 'Starting bulk crop with ' + padding + 'px padding...');
        $('#live-progress').show();

        let total = selectedImages.length;
        let completed = 0;
        let results = [];
        let successCount = 0;
        let errorCount = 0;

        function processNext() {
            if (completed >= total) {
                completeBulkCropWithPadding(results, successCount, errorCount, padding);
                return;
            }

            let imageId = selectedImages[completed];
            let progress = completed + 1;

            updateDetailedProgress(progress, total, 'Cropping image ID: ' + imageId + ' (padding: ' + padding + 'px)');
            updateLiveProgress(progress, total, 'Processing ' + progress + '/' + total);
            logProgress('🔄 Processing image ' + imageId + ' with ' + padding + 'px padding (' + progress + '/' + total + ')');

            $.ajax({
                url: ajax_object.ajax_url,
                type: 'POST',
                timeout: 60000,
                data: {
                    action: 'crop_with_padding',
                    image_id: imageId,
                    padding: padding,
                    nonce: ajax_object.nonce
                },
                success: function (response) {
                    if (response.success) {
                        successCount++;
                        refreshImagePreview(imageId);
                        logProgress('✅ Image ' + imageId + ' cropped successfully with ' + padding + 'px padding');
                        results.push({ ...response.data, success: true });

                        // Add to cropped images display
                        addCroppedImageToResults(response.data);
                    } else {
                        errorCount++;
                        logProgress('❌ Image ' + imageId + ' failed: ' + (response.data?.message || 'Unknown error'), true);
                        results.push({ ...response.data, success: false });
                    }
                },
                error: function (xhr, status, error) {
                    errorCount++;
                    logProgress('❌ Image ' + imageId + ' error: ' + error, true);
                    results.push({ success: false, image_id: imageId, message: 'AJAX error: ' + error });
                },
                complete: function () {
                    completed++;
                    // Delay between requests to prevent server overload
                    setTimeout(processNext, 500);
                }
            });
        }

        processNext();
    }

    function completeBulkCrop(results, successCount, errorCount) {
        isProcessing = false;
        $('#crop-selected').prop('disabled', false).text('🚀 Brzi Crop (5px)');

        let total = results.length;
        updateDetailedProgress(total, total, 'Completed! 🎉');
        updateLiveProgress(100, 100, 'Bulk crop of main images completed');

        logProgress('<strong>🏁 BULK CROP COMPLETED</strong>');
        logProgress('<strong>📊 SUMMARY: ' + successCount + ' successful, ' + errorCount + ' failed out of ' + total + ' main images</strong>');

        showQuickResult('🎉 Bulk crop completed: ' + successCount + '/' + total + ' main images successful');

        // Clear image selection after successful bulk crop
        if (successCount > 0) {
            selectedImages = [];
            $('.image-checkbox').prop('checked', false);
            updateSelectedImagesDisplay();
            updatePaddingControls();
        }

        // Auto-hide progress after delay
        setTimeout(function () {
            $('#live-progress').fadeOut();
        }, 5000);

        // Show completion notification
        if (successCount === total) {
            showNotification('🎉 All ' + total + ' main images cropped successfully!', 'success');
        } else if (successCount > 0) {
            showNotification('✅ ' + successCount + ' of ' + total + ' main images cropped successfully', 'success');
        } else {
            showNotification('❌ All crops failed. Check the detailed log for errors.', 'error');
        }
    }

    function completeBulkCropWithPadding(results, successCount, errorCount, padding) {
        isProcessing = false;
        $('#crop-with-padding').prop('disabled', false).text('🎯 Crop sa Padding');

        let total = results.length;
        updateDetailedProgress(total, total, 'Completed! 🎉');
        updateLiveProgress(100, 100, 'Bulk crop with ' + padding + 'px padding completed');

        logProgress('<strong>🏁 BULK CROP WITH PADDING COMPLETED</strong>');
        logProgress('<strong>📊 SUMMARY: ' + successCount + ' successful, ' + errorCount + ' failed out of ' + total + ' images (padding: ' + padding + 'px)</strong>');

        showQuickResult('🎉 Bulk crop completed: ' + successCount + '/' + total + ' images successful (' + padding + 'px padding)');

        // Clear image selection after successful bulk crop
        if (successCount > 0) {
            selectedImages = [];
            $('.image-checkbox').prop('checked', false);
            updateSelectedImagesDisplay();
            updatePaddingControls();
        }

        // Auto-hide progress after delay
        setTimeout(function () {
            $('#live-progress').fadeOut();
        }, 5000);

        // Show completion notification
        if (successCount === total) {
            showNotification('🎉 All ' + total + ' images cropped successfully with ' + padding + 'px padding!', 'success');
        } else if (successCount > 0) {
            showNotification('✅ ' + successCount + ' of ' + total + ' images cropped successfully', 'success');
        } else {
            showNotification('❌ All crops failed. Check the detailed log for errors.', 'error');
        }
    }

    function restoreImageFromBackup(imageId, button) {
        isProcessing = true;
        button.prop('disabled', true).text('Restoring...');

        updateLiveProgress(0, 100, 'Restoring image ' + imageId + ' from backup...');
        $('#live-progress').show();

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 60000,
            data: {
                action: 'restore_image_backup',
                image_id: imageId,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    button.text('✓ Restored').addClass('cropped');
                    updateLiveProgress(100, 100, 'Image restored successfully');
                    showQuickResult('✅ Image ' + imageId + ' restored from backup');
                    refreshImagePreview(imageId);

                    // Update backup status
                    loadBackupStatus([imageId]);

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    button.text('❌ Failed').addClass('failed');
                    updateLiveProgress(100, 100, 'Restore failed');
                    showQuickResult('❌ Image ' + imageId + ' restore failed: ' + (response.data?.message || 'Unknown error'), true);
                }
            },
            error: function (xhr, status, error) {
                button.text('❌ Error').addClass('failed');
                updateLiveProgress(100, 100, 'Error occurred');
                showQuickResult('❌ Image ' + imageId + ' restore error: ' + error, true);
            },
            complete: function () {
                isProcessing = false;
                setTimeout(function () {
                    button.prop('disabled', false);
                    if (!button.hasClass('cropped') && !button.hasClass('failed')) {
                        button.text('🔄 Restore');
                    }
                }, 3000);
            }
        });
    }

    function addCroppedImageToResults(data) {
        // Show cropped images section
        $('#cropped-images-section').show();

        // Add to cropped images array
        croppedImages.push(data);

        // Get image info
        let imageItem = $('.image-item[data-image-id="' + data.image_id + '"]');
        let imageTitle = imageItem.find('.image-title').text() || 'Main Image ' + data.image_id;
        let productName = imageItem.closest('.product-images-group').find('.product-group-title').text() || 'Unknown Product';

        let html = '<div class="cropped-image-item" data-image-id="' + data.image_id + '">';
        html += '<div class="cropped-image-preview">';
        html += '<img src="' + (data.cropped_url || '') + '" alt="Cropped ' + imageTitle + '" loading="lazy">';
        html += '</div>';
        html += '<div class="cropped-image-info">';
        html += '<h4 title="' + imageTitle + '">' + imageTitle + '</h4>';
        html += '<div class="cropped-image-meta">Product: ' + productName + '</div>';
        html += '<div class="cropped-image-meta">ID: ' + data.image_id + '</div>';
        if (data.new_size) {
            html += '<div class="cropped-image-meta">New Size: ' + data.new_size + '</div>';
        }
        if (data.padding_used) {
            html += '<div class="cropped-image-meta">Padding: ' + data.padding_used + 'px</div>';
        }
        html += '<div class="cropped-image-actions">';
        html += '<a href="' + (data.cropped_url || '') + '" target="_blank" class="button button-small">View Full</a>';
        html += '<button class="button button-small" onclick="navigator.clipboard.writeText(\'' + (data.cropped_url || '') + '\')">Copy URL</button>';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        $('#cropped-images-grid').prepend(html);
    }

    function refreshImagePreview(imageId) {
        let imageItem = $('.image-item[data-image-id="' + imageId + '"]');
        let img = imageItem.find('img');
        let currentSrc = img.attr('src');

        if (currentSrc) {
            let newSrc = currentSrc.split('?')[0] + '?v=' + Date.now();
            img.attr('src', newSrc);

            // Also refresh the "View" link
            let viewLink = imageItem.find('a[target="_blank"]');
            if (viewLink.length) {
                let currentHref = viewLink.attr('href');
                if (currentHref) {
                    let newHref = currentHref.split('?')[0] + '?v=' + Date.now();
                    viewLink.attr('href', newHref);
                }
            }
        }
    }
    // Dodaj search event handlers u setupEventHandlers():
    $('#search-products').on('input', function () {
        let searchTerm = $(this).val().trim();

        // Prikaži/sakrij clear button
        $('#clear-search').toggle(searchTerm.length > 0);

        // Dodaj search-active klasu
        if (searchTerm.length > 0) {
            $(this).closest('.category-controls').addClass('search-active');
        } else {
            $(this).closest('.category-controls').removeClass('search-active');
        }

        if (searchTerm.length >= 2 || searchTerm.length === 0) {
            currentSearchTerm = searchTerm;
            currentPage = 1;

            // Prikaži loading indikator
            if (searchTerm.length > 0) {
                $('#search-products').css('background', 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' viewBox=\'0 0 20 20\'%3E%3Cpath fill=\'%23999\' d=\'M10 3.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM2 10a8 8 0 1116 0 8 8 0 01-16 0z\' opacity=\'.4\'/%3E%3Cpath fill=\'%23999\' d=\'M10 3.5a6.5 6.5 0 011.5.18V2.27A8.02 8.02 0 0010 2a8 8 0 00-1.5.27v1.41A6.48 6.48 0 0110 3.5z\'%3E%3CanimateTransform attributeName=\'transform\' type=\'rotate\' from=\'0 10 10\' to=\'360 10 10\' dur=\'1s\' repeatCount=\'indefinite\'/%3E%3C/path%3E%3C/svg%3E") no-repeat right 10px center');
                $('#search-products').css('background-size', '16px 16px');
            }

            clearTimeout(window.searchTimeout);
            window.searchTimeout = setTimeout(function () {
                if (!isProcessing) {
                    loadCategoryProducts();
                }
            }, 500);
        }
    });

    $('#clear-search').on('click', function () {
        $('#search-products').val('').focus();
        $('#search-products').css('background', 'none');
        $('.category-controls').removeClass('search-active');
        currentSearchTerm = '';
        currentPage = 1;
        if (!isProcessing) {
            loadCategoryProducts();
        }
        $(this).hide();
    });
    // Prikaži/sakrij clear button
    $('#search-products').on('keypress', function (e) {
        if (e.which === 13) { // Enter key
            e.preventDefault();
            clearTimeout(window.searchTimeout);
            if (!isProcessing && currentSearchTerm.length >= 2) {
                loadCategoryProducts();
            }
        }
    });
    function showQuickResult(message, isError = false) {
        $('#quick-results').show();
        let currentContent = $('#quick-results-content').html();
        let timestamp = new Date().toLocaleTimeString();
        let resultClass = isError ? 'style="color: #d63638;"' : 'style="color: #00a32a;"';

        $('#quick-results-content').html(
            '[' + timestamp + '] <span ' + resultClass + '>' + message + '</span><br>' +
            currentContent
        );

        // Keep only last 5 results
        let lines = $('#quick-results-content').html().split('<br>');
        if (lines.length > 5) {
            $('#quick-results-content').html(lines.slice(0, 5).join('<br>'));
        }
    }

    function showNotification(message, type) {
        // Remove existing notifications
        $('.notification').remove();

        let notification = $('<div class="notification ' + type + '">' + message + '</div>');
        $('body').append(notification);

        notification.fadeIn(300).delay(type === 'error' ? 8000 : 5000).fadeOut(500, function () {
            $(this).remove();
        });
    }
});